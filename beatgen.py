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
QUIET_LEVEL = 0.08   # below this (share of the loud parts) the music counts as silent
MAX_GAP_BEATS = 1.7  # a gap longer than this many beats gets the missing beats filled in

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
        # overlap on both sides and no trimming: librosa otherwise drops the beats at the end
        # of each piece, which left holes of several seconds every 30 s
        lo = max(0, s - lead)
        chunk = onset[lo:s + seg + lead]
        if len(chunk) < fps * 4 or not chunk.any():
            continue
        found_tempo, found = librosa.beat.beat_track(onset_envelope=chunk, sr=SR, hop_length=HOP,
                                                     start_bpm=tempo, tightness=100, trim=False)
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
        frames = _fill_gaps(frames, rms, np.percentile(rms, 95) or 1.0)
    loud = np.percentile(rms, 95) or 1.0
    times = librosa.frames_to_time(np.array(frames), sr=SR, hop_length=HOP) * 1000
    levels = [min(1.0, float(rms[min(f, len(rms) - 1)]) / loud) for f in frames]
    return list(times), levels


def _smooth(values, frames):
    import numpy as np
    if frames <= 1:
        return values
    kernel = np.ones(frames) / frames
    return np.convolve(values, kernel, mode="same")


def vib_from_music(y, times):
    """Two vibration tracks (0..100) from the music, like hand-made .vib/.vib2 scripts:
    vib pulses on the beat with the loudness, vib2 (second motor) follows the bass slowly."""
    import numpy as np
    import librosa
    fps = SR / HOP
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    energy = _smooth(rms / (np.percentile(rms, 95) or 1.0), int(fps * 1.5))
    spec = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=SR, n_fft=2048)
    bass = spec[freqs < 150].sum(axis=0)
    bass = _smooth(bass / (np.percentile(bass, 95) or 1.0), int(fps * 1.0))

    def at(curve, ms):
        return float(curve[min(int(ms / 1000 * fps), len(curve) - 1)])

    def level(x):
        return int(min(100, max(0, round(x * 100 / 5) * 5)))

    vib = [{"at": 0, "pos": 0}]
    for t0, t1 in zip(times, times[1:]):
        e = min(1.0, at(energy, t0))
        if e < QUIET_LEVEL:  # silence: off
            if vib[-1]["pos"] != 0:
                vib.append({"at": int(t0), "pos": 0})
            continue
        peak = level(0.25 + 0.75 * e)            # strong on the beat
        rest = level((0.25 + 0.75 * e) * 0.55)   # softer between beats: a throb
        vib.append({"at": int(t0), "pos": peak})
        vib.append({"at": int(t0 + min(180, (t1 - t0) * 0.45)), "pos": rest})
    end = int(len(y) / SR * 1000)
    vib.append({"at": end, "pos": 0})

    vib2, last = [{"at": 0, "pos": 0}], 0
    for ms in range(0, end, 500):
        pos = level(min(1.0, at(bass, ms))) if at(energy, ms) >= QUIET_LEVEL else 0
        if pos != last:  # hold a level until it changes (like hand-made scripts)
            vib2.append({"at": ms, "pos": pos})
            last = pos
    vib2.append({"at": end, "pos": 0})
    return _clean(vib), _clean(vib2)


def _clean(actions):
    out = []
    for a in sorted(actions, key=lambda a: a["at"]):
        if out and a["at"] <= out[-1]["at"]:
            continue
        out.append(a)
    return out


def _fill_gaps(frames, rms, loud):
    """Beats the tracker missed while the music plays on: fill them in at the local tempo."""
    import numpy as np
    if len(frames) < 4:
        return frames
    out = [frames[0]]
    for i, f in enumerate(frames[1:], start=1):
        prev = out[-1]
        # local beat length from the beats just before and after the gap
        near = np.diff(frames[max(0, i - 5):i]).tolist() + np.diff(frames[i:i + 5]).tolist()
        period = float(np.median(near)) if near else f - prev
        gap = f - prev
        if period > 0 and gap > period * MAX_GAP_BEATS:
            n = round(gap / period)
            for k in range(1, n):
                g = int(round(prev + gap * k / n))
                if float(rms[min(g, len(rms) - 1)]) / loud >= QUIET_LEVEL:  # only where it isn't silent
                    out.append(g)
        out.append(f)
    return out


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
        if level < QUIET_LEVEL:  # near silence: no motion
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


def _funscript(actions, title, notes):
    return {"version": "1.0", "inverted": False, "range": 100,
            "metadata": {"title": title, "notes": notes}, "actions": actions}


def generate_all(path):
    """{"stroke", "vib", "vib2"} funscript dicts for the video at `path`, or raises RuntimeError."""
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
    notes = f"Lavet af Funscript Session ud fra musikken (~{bpm} BPM)"
    vib, vib2 = vib_from_music(y, times)
    return {"stroke": _funscript(actions, "Auto beat script", notes),
            "vib": _funscript(vib, "Auto vib script", notes + ", vibration paa beatet"),
            "vib2": _funscript(vib2, "Auto vib2 script", notes + ", vibration efter bassen")}


def generate(path):
    """Stroke funscript dict for the video at `path`, or raises RuntimeError."""
    return generate_all(path)["stroke"]
