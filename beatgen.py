"""Make a stroke script for a music video (PMV) from its beat.

Optional: needs librosa (pip install librosa). The audio is decoded with ffmpeg; the video file
is only read. Beats are tracked in 30 s pieces so compilations with several songs and tempos
work; there is one stroke per beat (bottom on the beat), its length follows the loudness, and
quiet passages hold still.
"""
import shutil
import subprocess

SR = 22050
HOP = 512
SEGMENT_S = 30
LEAD_IN_S = 3
MIN_STROKE_MS = 300  # faster than 200 strokes/min: one stroke per two beats

_FFMPEG = shutil.which("ffmpeg")


def available():
    if not _FFMPEG:
        return False
    try:
        import librosa  # noqa: F401
        import numpy  # noqa: F401
    except ImportError:
        return False
    return True


def _decode(path):
    import numpy as np
    raw = subprocess.run([_FFMPEG, "-nostdin", "-v", "error", "-i", str(path), "-vn", "-ac", "1",
                          "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, timeout=1800,
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    return np.frombuffer(raw, dtype=np.float32)


def track_beats(y):
    """Beat times (ms) and loudness per beat (0..1) for a whole track."""
    import numpy as np
    import librosa
    onset = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP, aggregate=np.median)
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    fps = SR / HOP
    seg, lead = int(SEGMENT_S * fps), int(LEAD_IN_S * fps)
    frames, tempo = [], 125.0
    for s in range(0, len(onset), seg):
        lo = max(0, s - lead)
        chunk = onset[lo:s + seg]
        if len(chunk) < fps * 4 or not chunk.any():
            continue
        found_tempo, found = librosa.beat.beat_track(onset_envelope=chunk, sr=SR, hop_length=HOP,
                                                     start_bpm=tempo, tightness=100)
        tempo = float(np.atleast_1d(found_tempo)[0]) or tempo
        frames.extend(int(lo + f) for f in found if s <= lo + f < s + seg)
    frames = sorted(set(frames))
    # drop beats closer than half the typical gap (doubles at piece borders)
    if len(frames) > 2:
        gaps = np.diff(frames)
        median = float(np.median(gaps))
        kept = [frames[0]]
        for f in frames[1:]:
            if f - kept[-1] >= median * 0.5:
                kept.append(f)
        frames = kept
    loud = np.percentile(rms, 95) or 1.0
    times = librosa.frames_to_time(np.array(frames), sr=SR, hop_length=HOP) * 1000
    levels = [min(1.0, float(rms[min(f, len(rms) - 1)]) / loud) for f in frames]
    return list(times), levels


def strokes_from_beats(times, levels):
    """One stroke per beat: bottom on the beat, top half way; quiet parts hold still."""
    actions = []
    i = 0
    while i < len(times) - 1:
        step = 1
        while i + step < len(times) - 1 and times[i + step] - times[i] < MIN_STROKE_MS:
            step += 1
        t0, t1 = times[i], times[i + step]
        level = levels[i]
        if level < 0.15:  # near silence: no motion
            i += step
            continue
        amp = 35 + 65 * min(1.0, level / 0.8)
        low, high = round((100 - amp) / 2), round(100 - (100 - amp) / 2)
        actions.append({"at": int(round(t0)), "pos": int(low)})
        actions.append({"at": int(round((t0 + t1) / 2)), "pos": int(high)})
        i += step
    actions.sort(key=lambda a: a["at"])
    deduped = []
    for a in actions:
        if deduped and a["at"] <= deduped[-1]["at"]:
            continue
        deduped.append(a)
    return deduped


def generate(path):
    """Funscript dict for the video at `path`, or raises RuntimeError."""
    if not available():
        raise RuntimeError("librosa er ikke installeret")
    y = _decode(path)
    if len(y) < SR * 5:
        raise RuntimeError("Videoen har ingen brugbar lyd")
    times, levels = track_beats(y)
    actions = strokes_from_beats(times, levels)
    if len(actions) < 10:
        raise RuntimeError("Fandt ikke nok beats i musikken")
    gaps = sorted(b - a for a, b in zip(times, times[1:]))
    bpm = round(60000 / gaps[len(gaps) // 2]) if gaps else 0
    return {
        "version": "1.0", "inverted": False, "range": 100,
        "metadata": {"title": "Auto beat script", "notes": f"Lavet af Funscript Session ud fra musikken (~{bpm} BPM)"},
        "actions": actions,
    }
