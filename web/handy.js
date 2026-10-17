/**
 * The Handy (firmware 4) over its own cloud API v3, HSSP mode: the whole session script is
 * uploaded once and the device plays it in sync with the video by itself. No Intiface needed.
 *
 * API v3 needs two keys:
 *  - Application ID (X-Api-Key) from a free developer account at https://user.handyfeeling.com
 *  - the device connection key (X-Connection-Key) from the Handy app
 * Both only ever go from this browser to handyfeeling.com.
 */
const Handy = (() => {
  const API = 'https://www.handyfeeling.com/api/handy-rest/v3';
  const UPLOAD = 'https://www.handyfeeling.com/api/hosting/v2/upload';
  const MAX_CSV_BYTES = 524288; // device limit for HSSP scripts

  let appId = '';
  let key = '';
  let connected = false;
  let clockOffset = 0;     // server_time - Date.now()
  let scriptId = null;     // which session the device currently has
  let setupPromise = null;
  let anchor = null;       // { startTime, wall } of the last play command

  function describe(error, status) {
    if (status === 401 || /unauthenticated/i.test(error.message || '')) return t('Ugyldigt Application ID');
    if (error.connected === false || error.name === 'DeviceNotConnected') return t('Handy er ikke online – tjek at den er på WiFi');
    return error.message || error.name || t('Handy-fejl (HTTP {status})', { status });
  }

  async function call(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: {
        'X-Api-Key': appId,
        'X-Connection-Key': key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(describe(data.error || {}, res.status));
    return data.result ?? {};
  }

  /** Estimate the server clock from several round trips, ignoring the slowest ones. */
  async function syncClock(samples = 16) {
    const results = [];
    for (let i = 0; i < samples; i += 1) {
      const t0 = Date.now();
      const { server_time: serverTime } = await fetch(`${API}/servertime`).then((r) => r.json());
      const t1 = Date.now();
      results.push({ rtd: t1 - t0, offset: serverTime + (t1 - t0) / 2 - t1 });
    }
    results.sort((a, b) => a.rtd - b.rtd);
    const best = results.slice(0, Math.ceil(samples / 2));
    clockOffset = best.reduce((sum, r) => sum + r.offset, 0) / best.length;
    return Math.round(best[0].rtd);
  }

  async function connect(applicationId, connectionKey) {
    appId = applicationId.trim();
    key = connectionKey.trim();
    connected = false;
    scriptId = null;
    setupPromise = null;
    if (!appId) throw new Error(t('Indtast dit Application ID (user.handyfeeling.com)'));
    if (!key) throw new Error(t('Indtast forbindelseskoden fra Handy-appen'));
    const { connected: online } = await call('GET', '/connected');
    if (!online) throw new Error(t('Handy er ikke online – tjek at den er på WiFi'));
    await call('PUT', '/mode2', { mode: 1 }); // HSSP
    await syncClock();
    connected = true;
  }

  function disconnect() {
    if (connected) call('PUT', '/hssp/stop').catch(() => {});
    connected = false;
    scriptId = null;
    setupPromise = null;
    anchor = null;
  }

  function toCsv(actions) {
    return actions.map((a) => `${Math.round(a.at)},${Math.round(a.pos)}`).join('\n') + '\n';
  }

  /** Upload the session script and hand it to the device (cached per session). */
  function prepare(session) {
    // content fingerprint, so an edited session (same id) is uploaded again
    const sum = session.actions.reduce((acc, a, i) => (acc + a.at * (a.pos + 1) * (i % 7 + 1)) % 1e12, 0);
    const id = `${session.id}:${session.actions.length}:${session.totalMs}:${sum}`;
    if (scriptId === id && setupPromise) return setupPromise;
    scriptId = id;
    setupPromise = (async () => {
      const csv = toCsv(session.actions);
      if (csv.length > MAX_CSV_BYTES) throw new Error(t('Sessionen er for lang til Handy (maks ca. 512 KB script)'));
      const form = new FormData();
      form.append('file', new Blob([csv], { type: 'text/csv' }), `session-${session.id}.csv`);
      const res = await fetch(UPLOAD, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(t('Upload af script til Handy fejlede'));
      await call('PUT', '/hssp/setup', { url: data.url });
    })();
    setupPromise.catch(() => { if (scriptId === id) { scriptId = null; setupPromise = null; } });
    return setupPromise;
  }

  async function play(startMs, rate = 1) {
    const startTime = Math.max(0, Math.round(startMs));
    anchor = { startTime, wall: performance.now(), rate };
    await call('PUT', '/hssp/play', {
      start_time: startTime,
      server_time: Math.round(Date.now() + clockOffset),
      playback_rate: rate,
    });
  }

  async function stop() {
    anchor = null;
    if (connected) await call('PUT', '/hssp/stop').catch(() => {});
  }

  /** Where the device should be in the script right now, from the last play command. */
  function expectedTime() {
    return anchor ? anchor.startTime + (performance.now() - anchor.wall) * anchor.rate : null;
  }

  /** Current motor temperature in °C (from the slider state). */
  async function motorTemp() {
    const state = await call('GET', '/slider/state');
    return typeof state.motor_temp === 'number' ? state.motor_temp : null;
  }

  /** Stroke zone in percent (0–100). */
  function setRange(min, max) {
    return connected ? call('PUT', '/slider/stroke', { min: min / 100, max: max / 100 }) : Promise.resolve();
  }

  return {
    connect, disconnect, prepare, play, stop, expectedTime, setRange, syncClock, motorTemp,
    get connected() { return connected; },
  };
})();
