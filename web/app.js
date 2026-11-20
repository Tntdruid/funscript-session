const $ = (id) => document.getElementById(id);

const ui = {
  libraryPath: $('libraryPath'), scanBtn: $('scanBtn'), scanStatus: $('scanStatus'),
  exportPath: $('exportPath'), exportBtn: $('exportBtn'), exportStatus: $('exportStatus'),
  libraryList: $('libraryList'), libraryCount: $('libraryCount'), librarySearch: $('librarySearch'),
  selectAll: $('selectAll'),
  remuxBox: $('remuxBox'), remuxBtn: $('remuxBtn'), remuxStatus: $('remuxStatus'), remuxBar: $('remuxBar'),
  emptyState: $('emptyState'), playBtn: $('playBtn'), prevBtn: $('prevBtn'), nextBtn: $('nextBtn'),
  timeNow: $('timeNow'), timeTotal: $('timeTotal'), clipInfo: $('clipInfo'), volume: $('volume'),
  levelBtn: $('levelBtn'), cueBtn: $('cueBtn'), cueVol: $('cueVol'),
  cueMode: $('cueMode'), voiceFolder: $('voiceFolder'), voiceScan: $('voiceScan'), voiceStatus: $('voiceStatus'),
  surprises: $('surprises'), surpriseBtn: $('surpriseBtn'), moreBtn: $('moreBtn'), lessBtn: $('lessBtn'), finishBtn: $('finishBtn'),
  liveCanvas: $('liveCanvas'), timelineCanvas: $('timelineCanvas'),
  lengthChips: $('lengthChips'), customMinutes: $('customMinutes'), clipLength: $('clipLength'),
  speedSlider: $('speedSlider'), speedLabel: $('speedLabel'), curveChips: $('curveChips'),
  buildBtn: $('buildBtn'), buildStatus: $('buildStatus'), sessionList: $('sessionList'),
  intifaceUrl: $('intifaceUrl'), connectBtn: $('connectBtn'), deviceState: $('deviceState'),
  offsetSlider: $('offsetSlider'), offsetLabel: $('offsetLabel'),
  rangeMin: $('rangeMin'), rangeMax: $('rangeMax'), rangeLabel: $('rangeLabel'),
  intifaceState: $('intifaceState'), bpDevicesList: $('bpDevices'),
  vibStrength: $('vibStrength'), vibStrengthLabel: $('vibStrengthLabel'), vibMode: $('vibMode'), vibModeLabel: $('vibModeLabel'),
  handyKey: $('handyKey'), handyAppId: $('handyAppId'), handyConnectBtn: $('handyConnectBtn'),
  categoryChips: $('categoryChips'), categoryLabel: $('categoryLabel'),
  rateSlider: $('rateSlider'), rateLabel: $('rateLabel'),
  tempValue: $('tempValue'), tempStatus: $('tempStatus'), tempLimit: $('tempLimit'), tempLimitLabel: $('tempLimitLabel'),
  warmupSlider: $('warmupSlider'), warmupLabel: $('warmupLabel'), warmupInfo: $('warmupInfo'),
  maxSpeedSlider: $('maxSpeedSlider'), maxSpeedLabel: $('maxSpeedLabel'), onlyFavs: $('onlyFavs'),
  smooth: $('smooth'),
};

const players = [$('videoA'), $('videoB')];

const state = {
  library: [],
  deselected: new Set(loadJson('deselected', [])),
  categories: new Set(loadJson('categories', [])), // empty = all categories
  onlyFavs: loadJson('onlyFavs', false),
  rate: 1,                                         // playback tempo for video and device
  minutes: 15,
  curve: 'constant',
  session: null,
  clipIndex: -1,
  playing: false,
  sessionTime: 0,
  markedPlayed: false,
};

let active = 0;          // index into players of the visible video
let switching = false;   // true while changing clip
let switchToken = 0;
let preload = null;      // { index, promise } for the hidden player
let envelope = null;     // per-pixel min/max of the session script for the timeline

// ------------------------------------------------------------------ helpers

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
function speedColor(speed, alpha = 1) {
  const t = clamp(speed / 400, 0, 1);
  return `hsla(${Math.round(210 - 210 * t)}, 85%, 58%, ${alpha})`;
}
function once(el, event, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const done = (ok) => () => {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener('error', onErr);
      ok ? resolve() : reject(new Error(`${event} failed`));
    };
    const onOk = done(true);
    const onErr = done(false);
    const timer = setTimeout(onErr, timeout);
    el.addEventListener(event, onOk);
    el.addEventListener('error', onErr);
  });
}
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', 'X-Lang': LANG },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
/** Index of the first action with at > t. */
function upperBound(actions, t) {
  let lo = 0;
  let hi = actions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (actions[mid].at <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}
function positionAt(actions, t) {
  if (!actions.length) return 50;
  const i = upperBound(actions, t);
  if (i === 0) return actions[0].pos;
  if (i >= actions.length) return actions[actions.length - 1].pos;
  const a = actions[i - 1];
  const b = actions[i];
  return a.pos + (b.pos - a.pos) * ((t - a.at) / Math.max(1, b.at - a.at));
}

// ------------------------------------------------------------------ library

async function loadSettings() {
  const { libraryPath, exportPath } = await api('/api/settings');
  ui.libraryPath.value = libraryPath;
  ui.exportPath.value = exportPath;
}

async function saveExportPath() {
  ui.exportBtn.disabled = true;
  ui.exportStatus.classList.remove('error');
  try {
    const { exportPath } = await api('/api/settings', { method: 'POST', body: { exportPath: ui.exportPath.value } });
    ui.exportPath.value = exportPath;
    ui.exportStatus.textContent = t('Gemt – sessioner skrives nu til denne mappe');
    loadSessions();
  } catch (err) {
    ui.exportStatus.textContent = err.message;
    ui.exportStatus.classList.add('error');
  } finally {
    ui.exportBtn.disabled = false;
  }
}

async function loadLibrary(remuxStatus = null) {
  const { videos } = await api('/api/library');
  state.library = videos;
  updateLoudnessTarget();
  renderCategories();
  renderLibrary();
  renderRemux(remuxStatus);
  if (!genAllPolling) renderGenAll();
  updateSpeedLabel();
}

/** A video's categories: its top folder, plus "PMV" for PMV / Cock Hero / beat videos wherever they lie. */
function videoCats(v) {
  return v.beat && v.category !== 'PMV' ? [v.category, 'PMV'] : [v.category];
}

function inCategory(v) {
  return !state.categories.size || videoCats(v).some((c) => state.categories.has(c));
}

/** Usable videos in the chosen categories (never ones rated 👎). */
function usableVideos() {
  return state.library.filter((v) => v.hasScript && v.playable && v.rating >= 0 && inCategory(v)
    && (!state.onlyFavs || v.rating > 0));
}

function renderCategories() {
  const counts = new Map();
  state.library.filter((v) => v.hasScript && v.playable)
    .forEach((v) => videoCats(v).forEach((c) => counts.set(c, (counts.get(c) || 0) + 1)));
  // forget categories that no longer exist
  [...state.categories].forEach((c) => { if (!counts.has(c)) state.categories.delete(c); });
  const names = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, 'da'));
  [ui.categoryChips, grid.categories].forEach((container) => {
    container.innerHTML = '';
    const all = document.createElement('button');
    all.textContent = t('Alle');
    all.className = state.categories.size ? '' : 'on';
    all.addEventListener('click', () => setCategories([]));
    container.appendChild(all);
    names.forEach((name) => {
      const b = document.createElement('button');
      b.textContent = `${t(name)} ${counts.get(name)}`;
      b.className = state.categories.has(name) ? 'on' : '';
      b.addEventListener('click', () => {
        const next = new Set(state.categories);
        if (next.has(name)) next.delete(name); else next.add(name);
        setCategories([...next]);
      });
      container.appendChild(b);
    });
  });
  ui.categoryLabel.textContent = state.categories.size ? t('{n} videoer', { n: usableVideos().length }) : t('alle');
}

function setCategories(list) {
  state.categories = new Set(list);
  saveJson('categories', list);
  renderCategories();
  renderLibrary();
  renderGrid();
  updateSpeedLabel();
}

function renderLibrary() {
  const query = ui.librarySearch.value.trim().toLowerCase();
  const usable = usableVideos();
  const shown = state.library.filter(inCategory);
  ui.libraryCount.textContent = `${usable.length}/${shown.length}`;
  ui.selectAll.checked = usable.every((v) => !state.deselected.has(v.id));

  const items = shown.filter((v) => !query || v.name.toLowerCase().includes(query));
  if (!items.length) {
    ui.libraryList.innerHTML = `<li class="empty-list">${state.library.length ? t('Ingen match') : t('Ingen videoer endnu – vælg en mappe og tryk Scan')}</li>`;
    return;
  }

  ui.libraryList.innerHTML = '';
  items.forEach((v) => {
    const li = makeLibraryRow(v);
    ui.libraryList.appendChild(li);
    if (v.speeds.length) drawSparkline(li.querySelector('canvas'), v.speeds);
  });
}

function makeLibraryRow(v) {
  const usableItem = v.hasScript && v.playable && v.rating >= 0;
  const li = document.createElement('li');
  li.className = (v.rating < 0 ? 'disliked' : (v.hasScript && v.playable ? '' : 'disabled')) + (v.canGenerate ? ' can-gen' : '');
  const reason = !v.playable
    ? (v.needsRemux ? t('MPEG-TS – skal konverteres') : t('kan ikke afspilles i browser'))
    : !v.hasScript ? t('intet script') : v.rating < 0 ? t('fravalgt') : `${Math.round(v.avgSpeed)} u/s`;
  li.innerHTML = `
    <input type="checkbox" ${usableItem && !state.deselected.has(v.id) ? 'checked' : ''} ${usableItem ? '' : 'disabled'} />
    <img class="thumb" loading="lazy" alt="" src="/thumb/${v.id}?h=420" />
    <div class="info">
      <span class="name" title="${escapeHtml(v.path)}">${escapeHtml(v.name)}</span>
      <span class="meta"><span>${fmtTime(v.durationMs)}</span>${v.canGenerate ? genButton(v) : `<span>${reason}</span>`}${autoBadge(v)}${issueBadge(v)}${vibBadge(v)}<canvas></canvas></span>
    </div>
    <div class="rate">
      <button class="fav ${v.rating > 0 ? 'on' : ''}" title="${t('Favorit – foretrækkes i sessioner')}">${v.rating > 0 ? '★' : '☆'}</button>
      <button class="nope ${v.rating < 0 ? 'on' : ''}" title="${t('Fravælg – bruges aldrig i sessioner')}">👎</button>
    </div>`;
  li.querySelector('.thumb').addEventListener('error', (e) => e.target.classList.add('missing'));
  li.querySelector('input').addEventListener('change', (e) => {
    if (e.target.checked) state.deselected.delete(v.id); else state.deselected.add(v.id);
    saveJson('deselected', [...state.deselected]);
    ui.selectAll.checked = usableVideos().every((x) => !state.deselected.has(x.id));
    updateSpeedLabel();
  });
  li.querySelector('.fav').addEventListener('click', () => rateVideo(v, v.rating > 0 ? 0 : 1, li));
  li.querySelector('.nope').addEventListener('click', () => rateVideo(v, v.rating < 0 ? 0 : -1, li));
  return li;
}

async function rateVideo(v, rating, li) {
  const before = v.rating;
  try {
    const res = await api(`/api/videos/${v.id}/rating`, { method: 'POST', body: { rating } });
    v.rating = res.rating;
  } catch (err) {
    ui.scanStatus.textContent = err.message;
    return;
  }
  const row = makeLibraryRow(v);
  li.replaceWith(row);
  if (v.speeds.length) drawSparkline(row.querySelector('canvas'), v.speeds);
  ui.libraryCount.textContent = `${usableVideos().length}/${state.library.filter(inCategory).length}`;
  renderCategories();
  updateSpeedLabel();
  if (rating < 0) {
    showToast(t('"{name}" bruges aldrig i sessioner', { name: v.title }), { undo: () => rateVideo(v, before, row) });
  }
}

// ------------------------------------------------------------------ beat scripts for PMVs

function genButton(v) {
  return v.canGenerate
    ? `<button class="gen-btn" data-gen="${v.id}" title="${t('Lav et script ud fra musikkens beat (tager ca. 10–60 sek)')}">🎵 ${t('Lav script')}</button>`
    : '';
}

function vibBadge(v) {
  if (!v.hasVib) return '';
  const title = v.autoVib ? t(v.beat ? 'Vib-scripts lavet automatisk ud fra musikken' : 'Vib-scripts lavet automatisk ud fra stroke-scriptet')
    : t('Har {x}-script', { x: v.hasVib2 ? '.vib + .vib2' : '.vib' });
  return `<span class="vib-badge${v.autoVib ? ' auto' : ''}" title="${title}">vib${v.hasVib2 ? '×2' : ''}${v.autoVib ? ' auto' : ''}</span>`;
}

/** "auto" badge, a switch between original and auto script, or a button to make an auto script. */
function autoBadge(v) {
  if (v.hasOriginal && v.hasAuto) {
    const to = v.autoScript ? 'original' : 'auto';
    const title = v.autoScript ? t('Bruger auto-scriptet. Klik for at bruge originalen')
      : t('Bruger originalen. Klik for at bruge auto-scriptet');
    return `<button class="script-switch${v.autoScript ? ' on' : ''}" data-use-script="${v.id}" data-to="${to}" title="${title}">${v.autoScript ? 'auto' : t('original')} ⇄</button>`;
  }
  if (v.canMakeVib && !v.canMakeAuto && !v.canGenerate) {
    const how = v.beat ? t('Lav vib-scripts til vibratorer (fx Lovense Gush/Edge) ud fra musikken')
      : t('Lav vib-scripts til vibratorer (fx Lovense Gush/Edge) ud fra stroke-scriptet');
    return `<button class="gen-btn" data-gen="${v.id}" title="${how}">📳 ${t('Lav vib')}</button>`;
  }
  if (v.canMakeAuto) {
    return `<button class="gen-btn" data-gen="${v.id}" title="${t('Lav et nyt script ud fra musikkens beat. Originalen bliver ikke rørt, og du kan skifte tilbage')}">🎵 ${t('Nyt script')}</button>`;
  }
  return v.autoScript ? `<span class="auto-badge" title="${t('Scriptet er lavet automatisk ud fra musikken')}">auto</span>` : '';
}

async function useScript(id, to, button) {
  button.disabled = true;
  try {
    await api(`/api/videos/${id}/script`, { method: 'POST', body: { use: to } });
    await loadLibrary();
    renderGrid();
  } catch (err) {
    button.disabled = false;
    alert(err.message);
  }
}

/** Start making a beat script and wait for it; the library reloads when it is done. */
async function generateScript(id, button) {
  button.disabled = true;
  button.textContent = t('Laver script…');
  try {
    await api(`/api/videos/${id}/generate`, { method: 'POST', body: {} });
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const status = await api('/api/generate/status');
      if (!status.running) {
        if (status.error) throw new Error(status.error);
        break;
      }
    }
    await loadLibrary();
    renderGrid();
  } catch (err) {
    button.disabled = false;
    button.textContent = `🎵 ${t('Lav script')}`;
    button.title = err.message;
    alert(err.message);
  }
}

document.addEventListener('click', (e) => {
  const swap = e.target.closest('[data-use-script]');
  if (swap) {
    e.stopPropagation();
    useScript(Number(swap.dataset.useScript), swap.dataset.to, swap);
    return;
  }
  const button = e.target.closest('[data-gen]');
  if (!button) return;
  e.stopPropagation();
  generateScript(Number(button.dataset.gen), button);
}, true);


// "Make scripts for all PMVs": a background job on the server, one video at a time.
let genAllPolling = false;

function renderGenAll(status = null) {
  const waiting = state.library.filter((v) => v.beat && (v.canGenerate || v.canMakeVib)).length;
  const vibWaiting = state.library.filter((v) => !v.beat && v.canMakeVib).length;
  const running = status?.running && status?.all;
  const made = state.library.filter((v) => v.autoScript).length;
  const remake = state.library.filter((v) => (v.hasAuto || v.autoVib) && v.playable).length;
  $('genVibBtn').classList.toggle('hidden', running || !vibWaiting);
  $('genVibBtn').textContent = `📳 ${t('Lav vib-scripts til alle andre videoer ({n})', { n: vibWaiting })}`;
  $('genRedoBtn').classList.toggle('hidden', running || !remake);
  $('genRedoBtn').textContent = `↻ ${t('Lav auto-scripts forfra ({n})', { n: remake })}`;
  $('genAllBox').classList.toggle('hidden', !waiting && !running && !status?.all && !made && !remake && !vibWaiting);
  const button = $('genAllBtn');
  button.textContent = running ? `⏹ ${t('Stop')}` : `🎵 ${t("Lav scripts til alle PMV'er ({n})", { n: waiting })}`;
  button.disabled = !running && !waiting;
  const done = status?.done || 0;
  const total = status?.total || 0;
  if (running) {
    $('genAllStatus').textContent = t('Laver script {a}/{b}: {name}', { a: done + 1, b: total, name: status.current || '…' });
  } else if (status?.all) {
    const failed = status.failed || [];
    $('genAllStatus').textContent = t('{n} scripts lavet', { n: done - failed.length })
      + (failed.length ? ` · ${t('{n} fejlede', { n: failed.length })}` : '');
    $('genAllStatus').title = failed.map((f) => `${f.name}: ${f.error}`).join('\n');
  } else if (!waiting) {
    $('genAllStatus').textContent = t("Alle PMV'er har et script ({n} lavet automatisk)", { n: made });
  } else {
    $('genAllStatus').textContent = t('Laver script og vib-scripts. Gemmes i mappen "Genererede scripts" i app-mappen, ikke ved videoerne. Tager ca. 1 sek per minut video.');
  }
  $('genAllBar').style.width = total ? `${(done / total) * 100}%` : '0';
}

async function pollGenAll() {
  if (genAllPolling) return;
  genAllPolling = true;
  try {
    let lastDone = -1;
    for (;;) {
      const status = await api('/api/generate/status');
      renderGenAll(status);
      if (status.done !== lastDone && lastDone >= 0) await loadLibrary(); // new scripts show up as they come
      lastDone = status.done;
      if (!status.running) { await loadLibrary(); renderGenAll(status); break; }
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    genAllPolling = false;
  }
}

async function toggleGenAll(mode = 'pmv') {
  const status = await api('/api/generate/status');
  if (status.running && status.all) {
    await api('/api/generate/stop', { method: 'POST', body: {} });
    return;
  }
  try {
    await api('/api/generate/all', { method: 'POST', body: { mode, redo: mode === 'redo' } });
    pollGenAll();
  } catch (err) {
    $('genAllStatus').textContent = err.message;
  }
}

// ------------------------------------------------------------------ picture grid

const grid = {
  overlay: $('gridOverlay'), list: $('gridList'), search: $('gridSearch'), sort: $('gridSort'),
  all: $('gridAll'), usableOnly: $('gridUsableOnly'), close: $('gridClose'),
  count: $('gridCount'), categories: $('gridCategories'), genre: $('gridGenre'),
  actor: $('gridActor'),
};

function gridOpen() {
  return !grid.overlay.classList.contains('hidden');
}

function openGrid() {
  grid.overlay.classList.remove('hidden');
  renderGenreOptions();
  renderActorOptions();
  renderGrid();
  grid.search.focus();
}

function closeGrid() {
  stopPreview();
  grid.overlay.classList.add('hidden');
  renderLibrary();
  updateSpeedLabel();
}

const GRID_SORTS = {
  name: (a, b) => a.name.localeCompare(b.name, 'da'),
  rating: (a, b) => b.rating - a.rating || a.name.localeCompare(b.name, 'da'),
  'speed-asc': (a, b) => a.avgSpeed - b.avgSpeed,
  'speed-desc': (a, b) => b.avgSpeed - a.avgSpeed,
  duration: (a, b) => b.durationMs - a.durationMs,
  played: (a, b) => a.playCount - b.playCount || a.name.localeCompare(b.name, 'da'),
  issues: (a, b) => (b.issues?.length || 0) - (a.issues?.length || 0) || a.name.localeCompare(b.name, 'da'),
  taste: (a, b) => (b.taste || 0) - (a.taste || 0) || a.name.localeCompare(b.name, 'da'),
};

function searchText(v) {
  return [v.title, v.name, v.studio, v.year, ...v.actors, ...v.genres].join(' ').toLowerCase();
}

function gridItems() {
  const words = grid.search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const genre = grid.genre.value.toLowerCase();
  const actor = grid.actor.value.toLowerCase();
  return state.library
    .filter((v) => inCategory(v) && (!grid.usableOnly.checked || (v.hasScript && v.playable)))
    .filter((v) => !genre || v.genres.some((g) => g.toLowerCase() === genre))
    .filter((v) => !actor || v.actors.some((a) => a.toLowerCase() === actor))
    .filter((v) => { const text = searchText(v); return words.every((w) => text.includes(w)); })
    .sort(GRID_SORTS[grid.sort.value] || GRID_SORTS.name);
}

/** Genre dropdown from the .nfo files ("Handy" is on nearly everything, so it is left out). */
/** Videos the dropdown counts cover: same as shown with "skjul uden script". */
function gridBase() {
  return state.library.filter((v) => !grid.usableOnly.checked || (v.hasScript && v.playable));
}

function renderGenreOptions() {
  const counts = new Map();
  gridBase().forEach((v) => v.genres.forEach((g) => {
    const key = g.toLowerCase();
    if (key !== 'handy') counts.set(key, { name: g, n: (counts.get(key)?.n || 0) + 1 });
  }));
  const current = grid.genre.value;
  const options = [...counts.values()].filter((g) => g.n > 1)
    .sort((a, b) => a.name.localeCompare(b.name, LANG, { sensitivity: 'base' }));
  grid.genre.innerHTML = `<option value="">${t('Alle genrer')}</option>`
    + options.map((g) => `<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)} (${g.n})</option>`).join('');
  grid.genre.value = options.some((g) => g.name === current) ? current : '';
}

/** Actor dropdown from the metadata, alphabetical, with how many videos each is in. */
function actorCounts() {
  const counts = new Map();
  gridBase().forEach((v) => v.actors.forEach((a) => {
    const key = a.toLowerCase();
    counts.set(key, { name: counts.get(key)?.name || a, n: (counts.get(key)?.n || 0) + 1 });
  }));
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, LANG, { sensitivity: 'base' }));
}

function renderActorOptions() {
  const current = grid.actor.value;
  const options = actorCounts();
  grid.actor.innerHTML = `<option value="">${t('Alle skuespillere')} (${options.length})</option>`
    + options.map((a) => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)} (${a.n})</option>`).join('');
  grid.actor.value = options.some((a) => a.name === current) ? current : '';
}

// ------------------------------------------------------------------ metadata editor
const meta = {
  dialog: $('metaDialog'), form: $('metaForm'), file: $('metaFile'), title: $('metaTitle'),
  actors: $('metaActors'), genres: $('metaGenres'), studio: $('metaStudio'), year: $('metaYear'),
  list: $('metaActorList'), video: null,
};

function openMetaEditor(v) {
  meta.video = v;
  meta.file.textContent = v.path;
  meta.title.value = v.title || '';
  meta.actors.value = v.actors.join(', ');
  meta.genres.value = v.genres.join(', ');
  meta.studio.value = v.studio || '';
  meta.year.value = v.year || '';
  $('metaReset').disabled = !v.metaEdited;
  meta.list.innerHTML = actorCounts().map((a) => `<option value="${escapeHtml(a.name)}"></option>`).join('');
  meta.dialog.showModal();
  meta.title.focus();
}

async function saveMeta(body) {
  const v = meta.video;
  try {
    const { video } = await api(`/api/videos/${v.id}/meta`, { method: 'POST', body });
    const i = state.library.findIndex((x) => x.id === v.id);
    if (i >= 0) state.library[i] = { ...state.library[i], ...video };
    meta.dialog.close();
    renderGenreOptions();
    renderActorOptions();
    renderGrid();
    renderLibrary();
  } catch (err) {
    alert(err.message);
  }
}

meta.form.addEventListener('submit', (e) => {
  e.preventDefault();
  saveMeta({
    title: meta.title.value, actors: meta.actors.value, genres: meta.genres.value,
    studio: meta.studio.value, year: meta.year.value,
  });
});
$('metaCancel').addEventListener('click', () => meta.dialog.close());
$('metaReset').addEventListener('click', () => saveMeta({ reset: true }));

function updateGridCount() {
  const usable = usableVideos();
  const chosen = usable.filter((v) => !state.deselected.has(v.id)).length;
  grid.count.textContent = t('{a} valgt · {b} vist', { a: chosen, b: grid.list.children.length });
  grid.all.checked = usable.every((v) => !state.deselected.has(v.id));
}

function renderGrid() {
  if (!gridOpen()) return;
  stopPreview();
  const frag = document.createDocumentFragment();
  gridItems().forEach((v) => frag.appendChild(makeGridCard(v)));
  grid.list.innerHTML = '';
  grid.list.appendChild(frag);
  grid.list.querySelectorAll('canvas[data-id]').forEach((c) => {
    const v = state.library.find((x) => x.id === Number(c.dataset.id));
    if (v?.speeds.length) drawSparkline(c, v.speeds);
  });
  updateGridCount();
}

function makeGridCard(v) {
  const usableItem = v.hasScript && v.playable && v.rating >= 0;
  const selected = usableItem && !state.deselected.has(v.id);
  const card = document.createElement('div');
  card.className = `vcard ${!v.hasScript || !v.playable ? 'disabled' : v.rating < 0 ? 'disliked' : selected ? 'on' : 'off'}${v.canGenerate ? ' can-gen' : ''}`;
  const info = !v.playable ? t('kan ikke afspilles') : !v.hasScript ? t('intet script') : `${Math.round(v.avgSpeed)} u/s`;
  card.title = `${v.name}\n${v.path}`;
  card.dataset.card = v.id;
  card.innerHTML = `
    <div class="poster">
      <img loading="lazy" alt="" src="/thumb/${v.id}?h=420" />
      <span class="check">✓</span>
      <div class="rate">
        <button class="fav ${v.rating > 0 ? 'on' : ''}" title="${t('Favorit')}">${v.rating > 0 ? '★' : '☆'}</button>
        <button class="nope ${v.rating < 0 ? 'on' : ''}" title="${t('Brug aldrig')}">👎</button>
        <button class="edit" title="${t('Rediger metadata')}">✎</button>
      </div>
      <span class="dur">${fmtTime(v.durationMs)}</span>
    </div>
    <div class="cinfo">
      <div class="cname">${escapeHtml(v.title)}</div>
      <div class="cpeople">${escapeHtml([v.actors.slice(0, 2).join(', '), v.year].filter(Boolean).join(' · '))}${v.metaEdited ? ` <span class="edited-badge" title="${t('Metadata er rettet i appen')}">✎</span>` : ''}</div>
      <div class="cmeta">${v.canGenerate ? genButton(v) : `<span>${info}</span>`}${autoBadge(v)}${v.taste > 0.3 ? `<span class="liked" title="${t('Lært: du ser den ofte færdig')}">♥</span>` : ''}${issueBadge(v)}${vibBadge(v)}<span>${escapeHtml(t(v.category))}</span></div>
      <div class="spark-wrap"><canvas data-id="${v.id}"></canvas><span class="spark-pos" hidden></span></div>
    </div>`;
  card.querySelector('img').addEventListener('error', (e) => e.target.classList.add('missing'));
  if (v.playable) {
    card.addEventListener('mouseenter', () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => startPreview(card, v), 350);
    });
    card.addEventListener('mouseleave', () => {
      clearTimeout(previewTimer);
      stopPreview();
    });
  }
  card.addEventListener('click', () => {
    if (!usableItem) return;
    if (state.deselected.has(v.id)) state.deselected.delete(v.id); else state.deselected.add(v.id);
    saveJson('deselected', [...state.deselected]);
    refreshGridCard(card, v);
  });
  card.querySelector('.edit').addEventListener('click', (e) => {
    e.stopPropagation();
    openMetaEditor(v);
  });
  card.querySelector('.fav').addEventListener('click', (e) => {
    e.stopPropagation();
    setGridRating(v, v.rating > 0 ? 0 : 1, card);
  });
  card.querySelector('.nope').addEventListener('click', (e) => {
    e.stopPropagation();
    setGridRating(v, v.rating < 0 ? 0 : -1, card);
  });
  return card;
}

// Hover preview: a muted video jumping through four points of the video.
const PREVIEW_POINTS = [0.15, 0.38, 0.62, 0.85];
let previewTimer = null;
let preview = null; // { card, video, timer }

function startPreview(card, v, range = null) {
  stopPreview();
  if (!card.isConnected || !v.durationMs) return;
  const from = range ? range.startMs / 1000 : 0;
  const span = range ? (range.endMs - range.startMs) / 1000 : v.durationMs / 1000;
  const video = document.createElement('video');
  video.className = 'preview';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const marker = card.querySelector('.spark-pos');
  let step = 0;
  const jump = () => {
    const f = PREVIEW_POINTS[step % PREVIEW_POINTS.length];
    video.currentTime = from + span * f;
    if (marker) { marker.hidden = false; marker.style.left = `${f * 100}%`; }
    step += 1;
  };
  video.addEventListener('loadedmetadata', () => {
    if (preview?.video !== video) return; // stopped while loading
    jump();
    video.play().catch(() => {});
    preview.timer = setInterval(jump, 2500);
  }, { once: true });
  video.src = `/media/${v.id}`;
  (card.querySelector('.poster') || card).appendChild(video);
  preview = { card, video, timer: null, marker };
}

function stopPreview() {
  if (!preview) return;
  clearInterval(preview.timer);
  preview.video.pause();
  preview.video.removeAttribute('src');
  preview.video.load(); // drop the connection to the file
  preview.video.remove();
  if (preview.marker) preview.marker.hidden = true;
  preview = null;
}

function refreshGridCard(card, v) {
  if (preview?.card === card) stopPreview();
  const fresh = makeGridCard(v);
  card.replaceWith(fresh);
  if (v.speeds.length) drawSparkline(fresh.querySelector('canvas'), v.speeds);
  updateGridCount();
}

async function setGridRating(v, rating, card) {
  const before = v.rating;
  try {
    v.rating = (await api(`/api/videos/${v.id}/rating`, { method: 'POST', body: { rating } })).rating;
  } catch (err) {
    grid.count.textContent = err.message;
    return;
  }
  refreshGridCard(card, v);
  renderCategories();
  if (rating < 0) {
    showToast(t('"{name}" bruges aldrig i sessioner', { name: v.title }), {
      undo: () => setGridRating(v, before, grid.list.querySelector(`[data-card="${v.id}"]`) || card),
    });
  }
}

/** Script problems found by the scan, as readable sentences. */
function describeIssues(v) {
  return (v.issues || []).map((i) => {
    if (i.code === 'ends_early') return t('Scriptet slutter {time} før videoen', { time: fmtTime(i.sec * 1000) });
    if (i.code === 'longer') return t('Scriptet er {time} længere end videoen', { time: fmtTime(i.sec * 1000) });
    if (i.code === 'gap') return t('Pause på {time} ved {at}', { time: fmtTime(i.sec * 1000), at: fmtTime(i.at * 1000) });
    if (i.code === 'fast') return t('Ekstremt hurtige stykker (op til {max} u/s)', { max: i.max });
    return i.code;
  });
}

function issueBadge(v) {
  const lines = describeIssues(v);
  return lines.length
    ? `<span class="issue-badge" title="${escapeHtml(`${t('Script-tjek')}:\n• ${lines.join('\n• ')}\n${t('Sessioner undgår de dårlige stykker.')}`)}">⚠</span>`
    : '';
}

function drawSparkline(canvas, speeds) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 120;
  const h = canvas.clientHeight || 16;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const barW = w / speeds.length;
  speeds.forEach((s, i) => {
    const bh = Math.max(1, clamp(s / 450, 0, 1) * h);
    ctx.fillStyle = speedColor(s);
    ctx.fillRect(i * barW, h - bh, Math.max(1, barW - 0.3), bh);
  });
}

async function scanLibrary() {
  ui.scanBtn.disabled = true;
  ui.scanStatus.classList.remove('error');
  try {
    await api('/api/settings', { method: 'POST', body: { libraryPath: ui.libraryPath.value } });
    await api('/api/scan', { method: 'POST', body: {} });
    for (;;) {
      await new Promise((r) => setTimeout(r, 400));
      const status = await api('/api/scan/status');
      if (status.error) throw new Error(status.error);
      ui.scanStatus.textContent = t('Scanner… {a}/{b}', { a: status.done, b: status.total });
      if (!status.running) {
        const summary = status.message ? JSON.parse(status.message) : null;
        ui.scanStatus.textContent = summary
          ? t('{found} videoer · {added} nye · {updated} opdateret · {removed} fjernet', summary)
          : t('Færdig');
        break;
      }
    }
    await loadLibrary();
  } catch (err) {
    ui.scanStatus.textContent = err.message;
    ui.scanStatus.classList.add('error');
  } finally {
    ui.scanBtn.disabled = false;
  }
}

// MPEG-TS files saved as .mp4 are copied into a real mp4 in a local cache (source is only read).
let remuxPolling = false;

function renderRemux(status = null) {
  const pending = state.library.filter((v) => v.needsRemux);
  const remuxed = state.library.filter((v) => v.remuxed).length;
  const running = status?.running;
  ui.remuxBox.classList.toggle('hidden', !pending.length && !running && !status?.failed?.length);
  ui.remuxBtn.disabled = !!running || !pending.length;
  ui.remuxBtn.textContent = t('Konverter MPEG-TS ({n})', { n: pending.length });
  ui.remuxStatus.classList.toggle('error', !!(status?.error || status?.failed?.length));
  if (running) {
    const pct = Math.round((status.progress || 0) * 100);
    ui.remuxStatus.textContent = t('Konverterer {a}/{b}: {name} · {pct}%', { a: status.done + 1, b: status.total, name: status.current, pct });
    ui.remuxBar.style.width = `${((status.done + (status.progress || 0)) / Math.max(1, status.total)) * 100}%`;
  } else if (status?.error || status?.failed?.length) {
    ui.remuxStatus.textContent = status.error || t('Fejlede: {list}', { list: status.failed.map((f) => `${f.name} (${f.error})`).join(', ') });
    ui.remuxBar.style.width = '0';
  } else {
    ui.remuxStatus.textContent = t('{n} videoer er MPEG-TS og kan ikke afspilles direkte. Konvertering kopierer dem (uden genkodning) til en lokal cache; originalerne røres ikke.', { n: pending.length })
      + (remuxed ? ` ${t('{n} er allerede konverteret.', { n: remuxed })}` : '');
    ui.remuxBar.style.width = '0';
  }
}

async function pollRemux() {
  if (remuxPolling) return;
  remuxPolling = true;
  try {
    let lastDone = -1;
    for (;;) {
      const status = await api('/api/remux/status');
      renderRemux(status);
      if (status.done !== lastDone && lastDone >= 0) await loadLibrary(status);
      lastDone = status.done;
      if (!status.running) { await loadLibrary(status); break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    remuxPolling = false;
  }
}

async function startRemux() {
  ui.remuxBtn.disabled = true;
  try {
    await api('/api/remux', { method: 'POST', body: {} });
    await pollRemux();
  } catch (err) {
    ui.remuxStatus.textContent = err.message;
    ui.remuxStatus.classList.add('error');
    ui.remuxBtn.disabled = false;
  }
}

// ------------------------------------------------------------------ session builder

function selectedIds() {
  return usableVideos().filter((v) => !state.deselected.has(v.id)).map((v) => v.id);
}

/** "auto" = vibration tracks only when a vibrator is connected through Intiface. */
function effectiveVibMode() {
  if (ui.vibMode.value !== 'auto') return ui.vibMode.value;
  return bpDevices.some((d) => !canStroke(d) && motorCount(d)) ? 'derive' : 'none';
}

function updateVibModeLabel() {
  ui.vibModeLabel.textContent = ui.vibMode.value !== 'auto' ? ''
    : effectiveVibMode() === 'none' ? t('nu: kun slag') : t('nu: med vibration');
}

function updateSpeedLabel() {
  const value = Number(ui.speedSlider.value);
  if (value > 0) {
    ui.speedLabel.textContent = `${value} u/s`;
    return;
  }
  const ids = new Set(selectedIds());
  const speeds = state.library.filter((v) => ids.has(v.id)).map((v) => v.avgSpeed).sort((a, b) => a - b);
  ui.speedLabel.textContent = speeds.length ? t('auto (≈{n} u/s)', { n: Math.round(speeds[Math.floor(speeds.length / 2)]) }) : t('auto');
}

function setChip(container, button) {
  container.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === button));
}

async function buildSession(overrides = {}) {
  const extra = overrides instanceof Event ? {} : overrides;
  const ids = selectedIds();
  if (!ids.length) {
    ui.buildStatus.textContent = t('Vælg mindst én video med script');
    return false;
  }
  ui.buildBtn.disabled = true;
  ui.buildStatus.textContent = t('Bygger…');
  try {
    const custom = Number(ui.customMinutes.value);
    const session = await api('/api/sessions/build', {
      method: 'POST',
      body: {
        minutes: custom > 0 ? custom : state.minutes,
        clipSeconds: Number(ui.clipLength.value) || null,
        targetSpeed: Number(ui.speedSlider.value) || null,
        maxSpeed: Number(ui.maxSpeedSlider.value) || null,
        warmupMinutes: Number(ui.warmupSlider.value) || 0,
        surprises: ui.surprises.checked,
        smooth: ui.smooth.checked,
        vibMode: effectiveVibMode(),
        curve: state.curve,
        videoIds: ids.length === state.library.filter((v) => v.hasScript && v.playable).length ? null : ids,
        seed: Math.floor(Math.random() * 1e9),
        ...extra,
      },
    });
    ui.buildStatus.textContent = t('{a} klip fra {b} videoer', { a: session.clips.length, b: new Set(session.clips.map((c) => c.videoId)).size });
    await loadSessions();
    if (state.edge && !extra.curve) endEdgeGame();
    await openSession(session);
    return true;
  } catch (err) {
    ui.buildStatus.textContent = err.message;
    return false;
  } finally {
    ui.buildBtn.disabled = false;
  }
}

async function loadSessions() {
  const { sessions } = await api('/api/sessions');
  if (!sessions.length) {
    ui.sessionList.innerHTML = `<li class="empty-list">${t('Ingen sessioner endnu')}</li>`;
    return;
  }
  ui.sessionList.innerHTML = '';
  sessions.forEach((s) => {
    const li = document.createElement('li');
    li.className = state.session?.id === s.id ? 'active' : '';
    const date = new Date(s.createdAt * 1000).toLocaleDateString(LANG === 'da' ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' });
    li.innerHTML = `
      <div class="s-main">
        <div class="s-name">${escapeHtml(s.name)}</div>
        <div class="s-meta">${fmtTime(s.totalMs)} · ${s.clipCount} ${t('klip')} · ${date}${s.playCount ? ` · ${t('afspillet {n}×', { n: s.playCount })}` : ''}${s.file ? ` · <span class="saved" title="${escapeHtml(s.file)}">${t('✓ gemt')}</span>` : ''}</div>
      </div>
      <div class="s-actions">
        <a href="/api/sessions/${s.id}/funscript" title="${t('Download samlet .funscript')}">⬇</a>
        ${s.hasVib ? `<a href="/api/sessions/${s.id}/funscript?track=vib" title="${t('Download vibrations-script (.vib.funscript)')}">vib</a>` : ''}
        <button class="sim" title="${t('Byg en ny session med samme indstillinger, men andre klip')}">🔁</button>
        <button class="ren" title="${t('Omdøb')}">✎</button>
        <button class="del" title="${t('Slet')}">✕</button>
      </div>`;
    li.querySelector('.s-main').addEventListener('click', async () => openSession(await api(`/api/sessions/${s.id}`)));
    li.querySelector('.sim').addEventListener('click', () => buildSimilar(s.id));
    li.querySelector('.ren').addEventListener('click', async () => {
      const name = prompt(t('Nyt navn til sessionen:'), s.name);
      if (name && name.trim() && name.trim() !== s.name) {
        try { await renameSession(s.id, name); } catch (err) { alert(err.message); }
      }
    });
    li.querySelector('.del').addEventListener('click', () => {
      li.hidden = true;  // gone at once, but only deleted when the message goes away without Fortryd
      showToast(t('"{name}" er slettet', { name: s.name }), {
        undo: () => { li.hidden = false; },
        onTimeout: () => api(`/api/sessions/${s.id}`, { method: 'DELETE' }).then(loadSessions).catch(() => {}),
      });
    });
    ui.sessionList.appendChild(li);
  });
}

// ------------------------------------------------------------------ playback

async function openSession(session, startIndex = 0, resume = false) {
  watched = {};
  if (state.session?.id !== session.id) { coachMarks = {}; coachClip = -1; }
  lastWatchTime = null;
  setPlaying(false);
  const sameSession = state.session?.id === session.id;
  state.session = session;
  state.clipIndex = -1;
  state.sessionTime = 0;
  if (!sameSession) state.markedPlayed = false;
  preload = null;
  players.forEach((p) => { p.removeAttribute('src'); delete p.dataset.src; p.load(); });
  ui.emptyState.hidden = true;
  resumeUi.box.hidden = true;
  ui.timeTotal.textContent = fmtTime(session.totalMs);
  envelope = null;
  renderClipStrip();
  loadSessions();
  if (Handy.connected) prepareHandy();
  await goToClip(clamp(startIndex, 0, session.clips.length - 1), 0);
  if (resume) setPlaying(true);
}

async function prepare(el, clip, offsetMs = 0) {
  const src = `/media/${clip.videoId}`;
  if (el.dataset.src !== src) {
    el.dataset.src = src;
    el.src = src;
    await once(el, 'loadedmetadata');
  }
  const t = (clip.startMs + offsetMs) / 1000;
  if (Math.abs(el.currentTime - t) > 0.05) {
    el.currentTime = t;
    await once(el, 'seeked');
  }
}

function preloadNext() {
  const clips = state.session?.clips || [];
  const index = state.clipIndex + 1;
  if (index >= clips.length) { preload = null; return; }
  const el = players[1 - active];
  preload = { index, promise: prepare(el, clips[index]).then(() => true, () => false) };
}

async function goToClip(index, offsetMs = 0) {
  const clips = state.session?.clips || [];
  if (index < 0 || index >= clips.length) return;
  const token = ++switchToken;
  switching = true;
  const clip = clips[index];
  const current = players[active];
  const standby = players[1 - active];
  let target = current;

  try {
    if (index === state.clipIndex) {
      current.currentTime = (clip.startMs + offsetMs) / 1000;
    } else {
      const pending = preload;
      preload = null;
      const ready = pending ? await pending.promise : false;
      if (token !== switchToken) return;
      if (!(ready && pending.index === index && offsetMs === 0)) {
        await prepare(standby, clip, offsetMs);
        if (token !== switchToken) return;
      }
      target = standby;
    }
  } catch (err) {
    console.warn('Kunne ikke indlæse klip', clip, err);
    ui.clipInfo.textContent = t('Kunne ikke indlæse {name}', { name: clip.name });
    switching = false;
    if (state.playing && index + 1 < clips.length) goToClip(index + 1);
    return;
  }

  if (target !== current) {
    current.pause();
    current.classList.add('hidden');
    target.classList.remove('hidden');
    active = players.indexOf(target);
  }
  state.clipIndex = index;
  state.sessionTime = clip.offsetMs + offsetMs;
  deviceCursor = -1;
  applyVolume();
  target.defaultPlaybackRate = state.rate;
  target.playbackRate = state.rate;
  target.muted = false;
  players[1 - active].muted = true;
  if (state.playing) {
    try { await target.play(); } catch (err) { console.warn(err); setPlaying(false); }
  }
  switching = false;
  checkHandyDrift(80, 0);
  updateClipInfo();
  if (state.clipIndex === index) preloadNext();
}

function seekSession(ms) {
  const clips = state.session?.clips;
  if (!clips?.length) return;
  const t = clamp(ms, 0, state.session.totalMs - 100);
  let index = clips.findIndex((c) => t < c.offsetMs + (c.endMs - c.startMs));
  if (index < 0) index = clips.length - 1;
  goToClip(index, t - clips[index].offsetMs);
}

function setPlaying(playing) {
  state.playing = playing;
  ui.playBtn.textContent = playing ? '❚❚' : '▶';
  const el = players[active];
  if (playing) {
    setupAudio();
    if (state.session && !state.markedPlayed) {
      state.markedPlayed = true;
      api(`/api/sessions/${state.session.id}/played`, { method: 'POST', body: {} }).catch(() => {});
    }
    if (el.src && !switching) {
      el.play().then(handySync, () => setPlaying(false));
    }
  } else {
    players.forEach((p) => p.pause());
    stopDevice();
    savePosition(true);
  }
}

/** Tempo for both video and device. The Handy is resynced once the slider is released. */
function setRate(rate, resync) {
  state.rate = clamp(Math.round(rate * 100) / 100, 0.5, 1.5);
  ui.rateSlider.value = state.rate;
  ui.rateLabel.textContent = `${Math.round(state.rate * 100)}%`;
  players.forEach((p) => { p.defaultPlaybackRate = state.rate; p.playbackRate = state.rate; });
  deviceCursor = -1;
  if (resync) handySync();
}

function togglePlay() {
  if (!state.session) return;
  if (!state.playing && overheated) {
    ui.tempStatus.textContent = t('Køler stadig af – vent lidt');
    return;
  }
  if (!state.playing && ui.tempStatus.textContent === t('Kølet af – tryk ▶ for at fortsætte')) ui.tempStatus.textContent = '';
  if (!state.playing && state.sessionTime >= state.session.totalMs - 200) {
    setPlaying(true);
    goToClip(0, 0);
    return;
  }
  setPlaying(!state.playing);
}

function updateClipInfo() {
  markActiveClip();
  const clips = state.session?.clips || [];
  const clip = clips[state.clipIndex];
  if (!clip) { ui.clipInfo.textContent = '–'; return; }
  ui.clipInfo.innerHTML = `${t('Klip {i}/{n}', { i: state.clipIndex + 1, n: clips.length })} · <b>${escapeHtml(clip.name)}</b> ` +
    `${fmtTime(clip.startMs)}–${fmtTime(clip.endMs)} · ${Math.round(clip.speed)} u/s`
    + (clip.rate ? ` · ${t('{n} slag/min', { n: clip.rate })}` : '')
    + (clip.vib ? ` · vib ${t(clip.vib)}` : '');
}

// ------------------------------------------------------------------ session clip strip + rename

const strip = {
  box: $('sessionStrip'), title: $('sessionTitle'), input: $('sessionTitleInput'),
  rename: $('renameBtn'), similar: $('similarBtn'), meta: $('sessionMeta'), list: $('clipStrip'),
};

function videoInfo(id) {
  return state.library.find((v) => v.id === id);
}

function renderClipStrip() {
  const session = state.session;
  strip.box.hidden = !session;
  if (!session) return;
  strip.title.textContent = session.name;
  const videos = new Set(session.clips.map((c) => c.videoId)).size;
  strip.meta.textContent = t('{n} klip · {v} videoer · {time}', { n: session.clips.length, v: videos, time: fmtTime(session.totalMs) });
  strip.list.innerHTML = '';
  session.clips.forEach((clip, i) => {
    const v = videoInfo(clip.videoId);
    const card = document.createElement('div');
    card.className = 'clip-card';
    card.title = `${v?.title || clip.name}\n${t('{range} i videoen', { range: `${fmtTime(clip.startMs)}–${fmtTime(clip.endMs)}` })}`;
    card.innerHTML = `
      <span class="num">${i + 1}</span>${clip.surprise ? `<span class="surprise-badge">${SURPRISE_ICONS[clip.surprise]}</span>` : ''}${clip.warmup ? `<span class="warm-badge">${t('Opvarmning')}</span>` : ''}
      <img loading="lazy" alt="" src="/thumb/${clip.videoId}?h=420" />
      <div class="ctext">
        <div class="ct">${escapeHtml(v?.title || clip.name)}</div>
        <div class="cm"><span class="speed-dot" style="background:${speedColor(clip.speed)}"></span>
          ${Math.round(clip.speed)} u/s · ${fmtTime(clip.endMs - clip.startMs)}</div>
      </div>`;
    card.querySelector('img').addEventListener('error', (e) => e.target.classList.add('missing'));
    card.addEventListener('click', () => { stopPreview(); goToClip(i, 0); });
    if (v?.playable) {  // hover: a muted look at exactly this clip
      card.addEventListener('mouseenter', () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => startPreview(card, v, clip), 400);
      });
      card.addEventListener('mouseleave', () => { clearTimeout(previewTimer); stopPreview(); });
    }
    card.insertAdjacentHTML('beforeend', `
      <div class="clip-actions">
        <button class="swap" title="${t('Byt med et andet klip i samme hastighed')}">🔄</button>
        <button class="remove" title="${t('Fjern klip fra sessionen')}">✕</button>
      </div>`);
    card.querySelector('.swap').addEventListener('click', (e) => { e.stopPropagation(); swapClip(i); });
    card.querySelector('.remove').addEventListener('click', (e) => { e.stopPropagation(); removeClip(i); });
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      dragFrom = i;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      strip.list.querySelectorAll('.drop-target').forEach((c) => c.classList.remove('drop-target'));
    });
    card.addEventListener('dragover', (e) => {
      if (dragFrom === null || dragFrom === i) return;
      e.preventDefault();
      card.classList.add('drop-target');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = dragFrom;
      dragFrom = null;
      if (from !== null && from !== i) moveClip(from, i);
    });
    strip.list.appendChild(card);
  });
  markActiveClip();
}

function markActiveClip() {
  [...strip.list.children].forEach((card, i) => {
    card.classList.toggle('now', i === state.clipIndex);
    card.classList.toggle('done', i < state.clipIndex);
  });
  const now = strip.list.children[state.clipIndex];
  if (now) strip.list.scrollLeft = now.offsetLeft - strip.list.clientWidth / 2 + now.clientWidth / 2;
}

// Editing clips: the server re-lays the clips and rebuilds stroke + vibration tracks.
let dragFrom = null;
let editing = false;

async function editSession(kind, body, focusIndex) {
  if (!state.session || editing) return;
  editing = true;
  const resume = state.playing;
  setPlaying(false);
  strip.meta.textContent = t('Opdaterer session…');
  try {
    const updated = await api(`/api/sessions/${state.session.id}/${kind}`, { method: 'POST', body });
    await openSession(updated, focusIndex, resume);
  } catch (err) {
    strip.meta.textContent = err.message;
  } finally {
    editing = false;
  }
}

function clipList() {
  return state.session.clips.map((c) => ({ ...c }));
}

function swapClip(i) {
  sendFeedback(state.session.clips[i], 'swap');
  editSession('swap', { index: i, videoIds: selectedIds(), seed: Math.floor(Math.random() * 1e9) }, i);
}

function removeClip(i) {
  const clips = clipList();
  if (clips.length < 2) {
    strip.meta.textContent = t('En session skal have mindst ét klip');
    return;
  }
  sendFeedback(clips[i], 'remove');
  clips.splice(i, 1);
  editSession('edit', { clips }, Math.min(i, clips.length - 1));
}

function moveClip(from, to) {
  const clips = clipList();
  const [moved] = clips.splice(from, 1);
  clips.splice(to, 0, moved);
  editSession('edit', { clips }, to);
}

/** New session with the same settings and video selection as session `id`, new clips. */
async function buildSimilar(id) {
  const status = state.session?.id === id ? strip.meta : ui.buildStatus;
  status.textContent = t('Bygger lignende session…');
  strip.similar.disabled = true;
  try {
    const session = await api(`/api/sessions/${id}/similar`, {
      method: 'POST', body: { seed: Math.floor(Math.random() * 1e9) },
    });
    await openSession(session);
  } catch (err) {
    status.textContent = err.message;
  } finally {
    strip.similar.disabled = false;
  }
}

async function renameSession(id, name) {
  const res = await api(`/api/sessions/${id}/rename`, { method: 'POST', body: { name } });
  if (state.session?.id === id) {
    state.session.name = res.name;
    strip.title.textContent = res.name;
  }
  loadSessions();
  return res.name;
}

function startRename() {
  if (!state.session) return;
  strip.input.value = state.session.name;
  strip.title.hidden = true;
  strip.input.hidden = false;
  strip.input.focus();
  strip.input.select();
}

async function finishRename(save) {
  if (strip.input.hidden) return;
  const name = strip.input.value.trim();
  strip.input.hidden = true;
  strip.title.hidden = false;
  if (save && name && name !== state.session.name) {
    try { await renameSession(state.session.id, name); } catch (err) { strip.meta.textContent = err.message; }
  }
}

// ------------------------------------------------------------------ resume where you left off

const resumeUi = { box: $('resumeBox'), text: $('resumeText'), yes: $('resumeBtn'), no: $('resumeNo') };
let resumePoint = null;
let lastSavedPosition = 0;

/** Remember the position on the server (every few seconds while playing, and on pause). */
function savePosition(force = false) {
  const session = state.session;
  if (!session || state.clipIndex < 0) return;
  if (!force && performance.now() - lastSavedPosition < 5000) return;
  lastSavedPosition = performance.now();
  const finished = state.sessionTime >= session.totalMs - 5000;
  const body = finished ? {} : { sessionId: session.id, ms: Math.round(state.sessionTime) };
  api('/api/resume', { method: 'POST', body }).catch(() => {});
}

async function offerResume() {
  try {
    resumePoint = (await api('/api/resume')).resume;
  } catch {
    resumePoint = null;
  }
  if (!resumePoint || resumePoint.ms < 10000 || state.session) return;
  resumeUi.text.innerHTML = t('Fortsæt {name} fra {time} af {total}?', {
    name: `<b>${escapeHtml(resumePoint.name)}</b>`, time: fmtTime(resumePoint.ms), total: fmtTime(resumePoint.totalMs),
  });
  resumeUi.box.hidden = false;
}

async function resumeSession() {
  if (!resumePoint) return;
  resumeUi.box.hidden = true;
  const session = await api(`/api/sessions/${resumePoint.sessionId}`);
  await openSession(session);
  seekSession(resumePoint.ms);
}

function dismissResume() {
  resumeUi.box.hidden = true;
  resumePoint = null;
  api('/api/resume', { method: 'POST', body: {} }).catch(() => {});
}

// ------------------------------------------------------------------ audio levelling
// Videos differ by up to ~30 dB. Each one's loudness is measured on the server; here every
// player gets a gain (volume × per-video correction) followed by a gentle compressor and a
// limiter, so quiet videos can be raised without distorting.

const GAIN_MIN_DB = -15;
const GAIN_MAX_DB = 18;
let audio = null;          // { ctx, gains, comp, limiter }
let loudnessTarget = null; // median loudness of the library (dB)
let levelAudio = loadJson('levelAudio', true);

function setupAudio() {
  if (audio) {
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
    return;
  }
  try {
    const ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24; comp.knee.value = 12; comp.ratio.value = 3;
    comp.attack.value = 0.01; comp.release.value = 0.3;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.002; limiter.release.value = 0.1;
    const gains = players.map((p) => {
      const gain = ctx.createGain();
      ctx.createMediaElementSource(p).connect(gain);
      p.volume = 1; // volume is applied in the gain node from now on
      return gain;
    });
    audio = { ctx, gains, comp, limiter };
    routeAudio();
    applyVolume();
  } catch (err) {
    console.warn('Web Audio ikke tilgængelig', err);
  }
}

function routeAudio() {
  if (!audio) return;
  const { ctx, gains, comp, limiter } = audio;
  [...gains, comp, limiter].forEach((node) => node.disconnect());
  if (levelAudio) {
    gains.forEach((g) => g.connect(comp));
    comp.connect(limiter);
    limiter.connect(ctx.destination);
  } else {
    gains.forEach((g) => g.connect(ctx.destination));
  }
}

function updateLoudnessTarget() {
  const levels = state.library.map((v) => v.loudness).filter((l) => l != null).sort((a, b) => a - b);
  loudnessTarget = levels.length ? levels[Math.floor(levels.length / 2)] : null;
}

/** Correction in dB for a video (0 when off or not measured yet). */
function videoGainDb(videoId) {
  const v = state.library.find((x) => x.id === videoId);
  if (!levelAudio || !v || v.loudness == null || loudnessTarget == null) return 0;
  return clamp(loudnessTarget - v.loudness, GAIN_MIN_DB, GAIN_MAX_DB);
}

function playerVideoId(p) {
  return Number((p.dataset.src || '').split('/').pop()) || null;
}

function applyVolume() {
  const volume = Number(ui.volume.value);
  const db = videoGainDb(playerVideoId(players[active]));
  ui.levelBtn.classList.toggle('on', levelAudio);
  ui.levelBtn.title = levelAudio
    ? t('Udjævn lydstyrke mellem videoer (denne video {db} dB)', { db: `${db >= 0 ? '+' : ''}${Math.round(db)}` })
    : t('Udjævn lydstyrke mellem videoer');
  if (!audio) {
    players.forEach((p) => { p.volume = volume; });
    return;
  }
  players.forEach((p, i) => {
    const gain = volume * 10 ** (videoGainDb(playerVideoId(p)) / 20) * (coachSpeaking ? 0.45 : 1);
    audio.gains[i].gain.setTargetAtTime(gain, audio.ctx.currentTime, 0.05);
  });
}

function toggleLevelAudio() {
  levelAudio = !levelAudio;
  saveJson('levelAudio', levelAudio);
  routeAudio();
  applyVolume();
}

/** Show progress while the server measures loudness, then pick up the new values. */
async function watchAudioMeasuring() {
  const hint = ui.scanStatus.textContent;
  let shown = false;
  for (;;) {
    let status;
    try { status = await api('/api/audio/status'); } catch { return; }
    if (!status.running) break;
    shown = true;
    if (!ui.scanBtn.disabled) {
      ui.scanStatus.textContent = t('Måler lydniveau {a}/{b}…', { a: status.done, b: status.total });
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (shown) {
    if (!ui.scanBtn.disabled) ui.scanStatus.textContent = hint;
    await loadLibrary();
  }
}

// ------------------------------------------------------------------ surprise me + sound cues

const SURPRISE_ICONS = { burst: '⚡', pause: '⏸', edge: '🔥', edge_stop: '⏸' };

/** 🎲: random pattern, speed and (sometimes) category; keeps the chosen length. */
function surpriseMe() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const curves = [...ui.curveChips.querySelectorAll('button')];
  const curve = pick(curves);
  curve.click();
  ui.speedSlider.value = pick([0, 140, 180, 220, 260, 300]);
  updateSpeedLabel();
  const counts = new Map();
  state.library.filter((v) => v.hasScript && v.playable && v.rating >= 0)
    .forEach((v) => videoCats(v).forEach((c) => counts.set(c, (counts.get(c) || 0) + 1)));
  const big = [...counts].filter(([, n]) => n >= 8).map(([name]) => name);
  setCategories(Math.random() < 0.5 || !big.length ? [] : [pick(big)]);
  ui.surprises.checked = true;
  buildSession();
}

// Sound cues instead of a voice: short, quiet sounds made with Web Audio (nothing to download).
let coachOn = loadJson('cuesOn', false);
let lastCoachAt = -Infinity;
let coachMarks = {};      // what has been signalled in this session (start, warm-up, last minute, end)
let coachClip = -1;
let cueCtx = null;

function cueContext() {
  // shares the player's AudioContext once it exists, otherwise makes its own
  cueCtx = audio?.ctx || cueCtx || new AudioContext();
  if (cueCtx.state === 'suspended') cueCtx.resume().catch(() => {});
  return cueCtx;
}

/** One soft tone: frequency glide `f0 -> f1` over `dur` seconds, starting `at` seconds from now. */
function tone(ctx, out, { f0, f1 = f0, dur = 0.4, at = 0, type = 'sine', peak = 0.5, attack = 0.01 }) {
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** Filtered noise sweeping up or down: a soft "whoosh". */
function whoosh(ctx, out, { from, to, dur = 0.6, peak = 0.35 }) {
  const t0 = ctx.currentTime;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.45);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  noise.connect(filter).connect(env).connect(out);
  noise.start(t0);
}


// Spoken lines, made by the user with Home Assistant TTS (see stemme-tekster.txt). A line whose
// recording is missing falls back to the sound cue.
const VOICE_LINES = {
  start: ['Så går vi i gang.', 'Læn dig tilbage, nu begynder det.'],
  warmupEnd: ['Opvarmningen er slut. Nu starter det.', 'Nu er du varm. Så kører vi.'],
  faster: ['Lidt hurtigere nu.', 'Tempoet stiger.', 'Op i gear.'],
  slower: ['Langsommere. Slap af.', 'Ned i tempo.', 'Rolig nu.'],
  pause: ['Hold en pause.', 'Stop. Træk vejret.', 'Hold igen. Ikke endnu.'],
  burst: ['Overraskelse! Hurtigt nu!', 'Fuld fart!'],
  edge: ['Op mod kanten.', 'Tæt på. Hold den.'],
  finale: ['Finale! Giv slip.', 'Sidste stræk. Nu!'],
  lastMinute: ['Sidste minut.', 'Et minut tilbage.'],
  more: ['Hurtigere.', 'Mere.'],
  less: ['Roligere.', 'Langsommere.'],
  finish: ['Så slutter vi af.', 'Finalen starter nu.'],
  end: ['Godt klaret.', 'Det var det. Godt gået.'],
};
let voiceFiles = {};          // normalized line -> url
let coachSpeaking = false;
const voicePlayer = new Audio();
voicePlayer.addEventListener('play', () => { coachSpeaking = true; applyVolume(); });
['ended', 'pause', 'error'].forEach((e) => voicePlayer.addEventListener(e, () => { coachSpeaking = false; applyVolume(); }));

/** Same rule as the server: 'Stop. Træk vejret!' -> 'stop træk vejret'. */
function normLine(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function allVoiceLines() {
  return [...new Set(Object.values(VOICE_LINES).flat())];
}

/** Plays a recorded line for `event` if there is one; false = use the sound cue. */
function speakLine(event) {
  if (ui.cueMode.value !== 'voice' || LANG !== 'da') return false;
  const have = (VOICE_LINES[event] || []).filter((line) => voiceFiles[normLine(line)]);
  if (!have.length) return false;
  voicePlayer.pause();
  voicePlayer.src = voiceFiles[normLine(have[Math.floor(Math.random() * have.length)])];
  voicePlayer.volume = Number(ui.cueVol.value);
  voicePlayer.play().catch(() => {});
  return true;
}

function showVoiceStatus() {
  const lines = allVoiceLines();
  const missing = lines.filter((l) => !voiceFiles[normLine(l)]);
  ui.voiceStatus.textContent = t('{a} af {b} tekster fundet', { a: lines.length - missing.length, b: lines.length });
  ui.voiceStatus.title = missing.length ? `${t('Mangler')}:\n${missing.join('\n')}` : '';
}

function showCueMode() {
  $('voiceBox').hidden = ui.cueMode.value !== 'voice';
}

async function loadVoices() {
  try {
    const res = await api('/api/voice');
    voiceFiles = res.lines || {};
    if (res.folder) ui.voiceFolder.value = res.folder;
  } catch { voiceFiles = {}; }
  showVoiceStatus();
}

async function scanVoices() {
  ui.voiceScan.disabled = true;
  ui.voiceStatus.textContent = t('Henter…');
  try {
    const res = await api('/api/voice/scan', {
      method: 'POST', body: { folder: ui.voiceFolder.value, lines: allVoiceLines() },
    });
    voiceFiles = res.lines || {};
    showVoiceStatus();
  } catch (err) {
    ui.voiceStatus.textContent = err.message;
  } finally {
    ui.voiceScan.disabled = false;
  }
}

const CUES = {
  start: (c, o) => { tone(c, o, { f0: 523, dur: 0.6 }); tone(c, o, { f0: 784, dur: 0.9, at: 0.18 }); },
  warmupEnd: (c, o) => { tone(c, o, { f0: 587, dur: 0.6 }); tone(c, o, { f0: 880, dur: 0.9, at: 0.18 }); },
  faster: (c, o) => whoosh(c, o, { from: 300, to: 2400 }),
  slower: (c, o) => whoosh(c, o, { from: 2400, to: 300 }),
  pause: (c, o) => tone(c, o, { f0: 196, dur: 1.6, attack: 0.12, peak: 0.45 }),
  burst: (c, o) => [0, 0.07, 0.14, 0.21].forEach((at, i) => tone(c, o, { f0: 440 * 1.26 ** i, dur: 0.18, at, type: 'triangle', peak: 0.35 })),
  edge: (c, o) => tone(c, o, { f0: 220, f1: 660, dur: 1.4, attack: 0.5, type: 'triangle', peak: 0.3 }),
  finale: (c, o) => [1, 2.76, 5.4].forEach((m, i) => tone(c, o, { f0: 98 * m, dur: 3.2 - i * 0.8, attack: 0.005, peak: 0.45 / (i + 1) })),
  lastMinute: (c, o) => { tone(c, o, { f0: 1320, dur: 0.08, peak: 0.3 }); tone(c, o, { f0: 1320, dur: 0.08, at: 0.22, peak: 0.3 }); },
  more: (c, o) => tone(c, o, { f0: 660, f1: 990, dur: 0.16, type: 'triangle', peak: 0.3 }),
  less: (c, o) => tone(c, o, { f0: 990, f1: 660, dur: 0.16, type: 'triangle', peak: 0.3 }),
  end: (c, o) => [784, 659, 523].forEach((f, i) => tone(c, o, { f0: f, dur: 0.9, at: i * 0.22 })),
};
CUES.finish = CUES.finale;

function cue(event, force = false) {
  if (!coachOn || !CUES[event]) return;
  const now = performance.now();
  // never too busy: 4 s between cues, 1.5 s for important ones; answers to ▲▼⏹ come at once
  const userAction = ['more', 'less', 'finish'].includes(event);
  if (!userAction && now - lastCoachAt < (force ? 1500 : 4000)) return;
  lastCoachAt = now;
  if (speakLine(event)) return;
  try {
    const ctx = cueContext();
    const out = ctx.createGain();
    out.gain.value = Number(ui.cueVol.value);
    out.connect(ctx.destination);
    CUES[event](ctx, out);
  } catch (err) {
    console.warn('Lyd-signal fejlede', err);
  }
}

/** Called on every tick: a cue on clip changes and on session milestones. */
function coachTick() {
  const session = state.session;
  if (!coachOn || !session || !state.playing || switching) return;
  const left = session.totalMs - state.sessionTime;
  const warmEnd = warmupEnd();
  if (!coachMarks.start) { coachMarks.start = true; cue('start', true); return; }
  if (warmEnd && !coachMarks.warmup && state.sessionTime >= warmEnd) {
    coachMarks.warmup = true; cue('warmupEnd', true); return;
  }
  if (!coachMarks.lastMinute && session.totalMs > 180000 && left < 60000 && left > 50000) {
    coachMarks.lastMinute = true; cue('lastMinute', true); return;
  }
  if (state.clipIndex === coachClip) return;
  const prev = session.clips[coachClip];
  const clip = session.clips[state.clipIndex];
  coachClip = state.clipIndex;
  if (!prev || !clip || clip.warmup) return;
  const base = session.params?.targetSpeed || prev.targetSpeed || 200;
  if (clip.surprise === 'burst') cue('burst', true);
  else if (clip.surprise === 'edge') cue('edge', true);
  else if (clip.surprise === 'pause' || clip.surprise === 'edge_stop' || clip.targetSpeed < base * 0.55) cue('pause');
  else if (left < 150000 && clip.targetSpeed > base * 1.3) cue('finale');
  else if (clip.targetSpeed > prev.targetSpeed * 1.12) cue('faster');
  else if (clip.targetSpeed < prev.targetSpeed * 0.88) cue('slower');
}

function toggleCoach() {
  coachOn = !coachOn;
  saveJson('cuesOn', coachOn);
  ui.cueBtn.classList.toggle('on', coachOn);
  if (coachOn) { lastCoachAt = -Infinity; cue('start', true); }
}

// ------------------------------------------------------------------ live steering + learning

let steering = false;
let watched = {};        // clip index -> ms actually played (seeks don't count)
let lastWatchTime = null;

/** Count real playing time per clip; used to tell "watched to the end" from "skipped". */
function trackWatching() {
  if (!state.playing || switching || state.clipIndex < 0) { lastWatchTime = null; return; }
  if (lastWatchTime !== null) {
    const step = state.sessionTime - lastWatchTime;
    if (step > 0 && step < 1500) watched[state.clipIndex] = (watched[state.clipIndex] || 0) + step;
  }
  lastWatchTime = state.sessionTime;
}

function sendFeedback(clip, kind) {
  if (!clip || clip.warmup) return;
  api('/api/feedback', {
    method: 'POST', body: { videoId: clip.videoId, startMs: clip.startMs, endMs: clip.endMs, kind },
  }).catch(() => {});
}

function clipShare(i) {
  const clip = state.session?.clips[i];
  return clip ? (watched[i] || 0) / Math.max(1, clip.endMs - clip.startMs) : 0;
}

/** ⏭ by hand: leaving a clip before half of it played counts as "skipped". */
function nextClip() {
  const i = state.clipIndex;
  if (state.session && i >= 0 && clipShare(i) < 0.5) sendFeedback(state.session.clips[i], 'skip');
  goToClip(i + 1);
}

/** ▲ / ▼ / ⏹: re-pick the clips after the one playing now, without stopping. */
async function steer(mode) {
  if (!state.session || steering || state.clipIndex < 0) return;
  steering = true;
  [ui.moreBtn, ui.lessBtn, ui.finishBtn].forEach((b) => { b.disabled = true; });
  const from = state.clipIndex;
  strip.meta.textContent = t('Vælger nye klip…');
  try {
    const updated = await api(`/api/sessions/${state.session.id}/steer`, {
      method: 'POST', body: { fromIndex: from, mode, seed: Math.floor(Math.random() * 1e9) },
    });
    state.session = updated;
    preload = null;
    envelope = null;
    Object.keys(watched).forEach((k) => { if (Number(k) > from) delete watched[k]; });
    ui.timeTotal.textContent = fmtTime(updated.totalMs);
    renderClipStrip();
    updateClipInfo();
    loadSessions();
    if (state.clipIndex > from) {
      goToClip(state.clipIndex, 0); // already moved on into a clip that was replaced
    } else {
      preloadNext();
      if (state.playing) handySync(); // the device gets the new script, same position
    }
  } catch (err) {
    strip.meta.textContent = err.message;
  } finally {
    steering = false;
    [ui.moreBtn, ui.lessBtn, ui.finishBtn].forEach((b) => { b.disabled = false; });
  }
}

function forgetTaste() {
  showToast(t('Appen glemmer, hvad den har lært om, hvad du kan lide'), {
    undo: () => {},
    onTimeout: async () => {
      await api('/api/feedback/reset', { method: 'POST', body: {} });
      await loadLibrary();
      renderGrid();
    },
  });
}

// ------------------------------------------------------------------ fullscreen

const videoWrap = document.querySelector('.video-wrap');
const fs = {
  bar: $('fsBar'), play: $('fsPlay'), next: $('fsNext'), time: $('fsTime'),
  progress: $('fsProgress'), fill: $('fsProgressFill'), clip: $('fsClip'), exit: $('fsExit'),
};
let hideUiTimer = null;

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else videoWrap.requestFullscreen().catch((err) => console.warn('Fuldskærm afvist', err));
}

/** Show the control bar for a moment after the mouse moves. */
function showFullscreenUi() {
  videoWrap.classList.add('show-ui');
  clearTimeout(hideUiTimer);
  hideUiTimer = setTimeout(() => {
    if (state.playing && !fs.bar.matches(':hover')) videoWrap.classList.remove('show-ui');
  }, 2500);
}

function updateFullscreenBar() {
  const total = state.session?.totalMs || 0;
  fs.play.textContent = state.playing ? '❚❚' : '▶';
  fs.time.textContent = `${fmtTime(state.sessionTime)} / ${fmtTime(total)}`;
  fs.fill.style.width = total ? `${(state.sessionTime / total) * 100}%` : '0';
  const clip = state.session?.clips[state.clipIndex];
  const warn = overheated ? `<span class="hot">${t('⚠ Handy køler af')}</span> · ` : '';
  const text = clip ? `${warn}${state.clipIndex + 1}/${state.session.clips.length} · ${escapeHtml(clip.name)}` : warn;
  if (fs.clip.innerHTML !== text) fs.clip.innerHTML = text;
}

/** Playback logic runs on a timer so it keeps going when the window is in the background. */
function tick() {
  const clips = state.session?.clips;
  const clip = clips?.[state.clipIndex];
  if (clip) {
    const el = players[active];
    const videoMs = el.currentTime * 1000;
    const clipLen = clip.endMs - clip.startMs;
    if (!switching) {
      state.sessionTime = clip.offsetMs + clamp(videoMs - clip.startMs, 0, clipLen);
      trackWatching();
      if (state.playing && (videoMs >= clip.endMs - 30 || el.ended)) {
        if (clipShare(state.clipIndex) >= 0.7) sendFeedback(clip, 'complete');
        if (state.clipIndex + 1 < clips.length) {
          goToClip(state.clipIndex + 1);
        } else {
          state.sessionTime = state.session.totalMs;
          if (endlessContinue()) return;
          if (!coachMarks.end) { coachMarks.end = true; cue('end', true); }
          setPlaying(false);
          endEdgeGame();
        }
      }
    }
    driveDevice(state.sessionTime);
    endlessTick();
    checkHandyDrift();
    if (state.playing) savePosition();
    coachTick();
  }
}

/** End of the warm-up (ms into the session), 0 when the session has none. */
function warmupEnd(session = state.session) {
  return (session?.clips || []).filter((c) => c.warmup)
    .reduce((end, c) => Math.max(end, c.offsetMs + c.endMs - c.startMs), 0);
}

function updateWarmupInfo() {
  const end = warmupEnd();
  const left = end - state.sessionTime;
  ui.warmupInfo.hidden = !(left > 0);
  if (left > 0) ui.warmupInfo.textContent = t('Opvarmning – Handy står stille · {time} tilbage', { time: fmtTime(left) });
}

function frame() {
  ui.timeNow.textContent = fmtTime(state.sessionTime);
  updateWarmupInfo();
  if (document.fullscreenElement === videoWrap) updateFullscreenBar();
  drawLive();
  drawTimeline();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ drawing

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    if (canvas === ui.timelineCanvas) envelope = null;
  }
  return { ctx: canvas.getContext('2d'), w, h, dpr };
}

function drawLive() {
  const { ctx, w, h, dpr } = fitCanvas(ui.liveCanvas);
  ctx.clearRect(0, 0, w, h);
  const actions = state.session?.actions;
  if (!actions?.length) return;

  const before = 2000;
  const after = 6000;
  const t = state.sessionTime;
  const x = (at) => ((at - (t - before)) / (before + after)) * w;
  const pad = 6 * dpr;
  const y = (pos) => h - pad - (pos / 100) * (h - pad * 2);

  // clip boundaries
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = dpr;
  state.session.clips.forEach((c) => {
    if (c.offsetMs > t - before && c.offsetMs < t + after) {
      ctx.beginPath(); ctx.moveTo(x(c.offsetMs), 0); ctx.lineTo(x(c.offsetMs), h); ctx.stroke();
    }
  });

  // vibration track (only shown when an Intiface vibrator is connected)
  const vib = state.session.vib;
  if (vib?.length && bpDevices.some((d) => motorCount(d))) {
    let k = Math.max(0, upperBound(vib, t - before) - 1);
    ctx.beginPath();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = 'rgba(176, 132, 255, 0.8)';
    ctx.moveTo(x(vib[k].at), y(vib[k].pos));
    for (k += 1; k < vib.length; k += 1) {
      ctx.lineTo(x(vib[k].at), y(vib[k].pos));
      if (vib[k].at > t + after) break;
    }
    ctx.stroke();
  }

  let i = Math.max(0, upperBound(actions, t - before) - 1);
  ctx.beginPath();
  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = '#ff4f7b';
  ctx.moveTo(x(actions[i].at), y(actions[i].pos));
  for (i += 1; i < actions.length; i += 1) {
    ctx.lineTo(x(actions[i].at), y(actions[i].pos));
    if (actions[i].at > t + after) break;
  }
  ctx.stroke();

  const px = x(t);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = dpr;
  ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(px, y(positionAt(actions, t)), 5 * dpr, 0, Math.PI * 2); ctx.fill();
}

function buildEnvelope(w) {
  const { actions, totalMs } = state.session;
  const env = Array.from({ length: w }, () => [101, -1]);
  const col = (at) => clamp(Math.floor((at / totalMs) * w), 0, w - 1);
  for (let i = 0; i < actions.length; i += 1) {
    const a = actions[i];
    const b = actions[i + 1] || a;
    for (let c = col(a.at); c <= col(b.at); c += 1) {
      env[c][0] = Math.min(env[c][0], a.pos, b.pos);
      env[c][1] = Math.max(env[c][1], a.pos, b.pos);
    }
  }
  return env;
}

function drawTimeline() {
  const { ctx, w, h, dpr } = fitCanvas(ui.timelineCanvas);
  ctx.clearRect(0, 0, w, h);
  if (!state.session) return;
  const { clips, totalMs } = state.session;
  if (!envelope) envelope = buildEnvelope(w);

  clips.forEach((c, i) => {
    const x0 = (c.offsetMs / totalMs) * w;
    const x1 = ((c.offsetMs + c.endMs - c.startMs) / totalMs) * w;
    ctx.fillStyle = speedColor(c.speed, i === state.clipIndex ? 0.35 : 0.18);
    ctx.fillRect(x0, 0, x1 - x0, h);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x0, 0, dpr, h);
  });

  const warmEnd = warmupEnd();
  if (warmEnd) {
    ctx.fillStyle = 'rgba(80, 130, 220, 0.25)';
    ctx.fillRect(0, 0, (warmEnd / totalMs) * w, h);
  }

  const pad = 4 * dpr;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  envelope.forEach(([lo, hi], x) => {
    if (hi < 0) return;
    const y1 = h - pad - (hi / 100) * (h - pad * 2);
    const y0 = h - pad - (lo / 100) * (h - pad * 2);
    ctx.fillRect(x, y1, 1, Math.max(1, y0 - y1));
  });

  const px = (state.sessionTime / totalMs) * w;
  ctx.fillStyle = '#ff4f7b';
  ctx.fillRect(px - dpr, 0, 2 * dpr, h);
}

// ------------------------------------------------------------------ device (Buttplug / Intiface)

let bpClient = null;
let bpDevices = [];      // every device Intiface reports; each gets its own send state
let deviceCursor = -1;   // stroke cursor for linear devices (shared: they play the same track)

function loadButtplug() {
  if (window.buttplug) return Promise.resolve(window.buttplug);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/buttplug@3.2.2/dist/web/buttplug.min.js';
    s.onload = () => resolve(window.buttplug);
    s.onerror = () => reject(new Error(t('Kunne ikke hente buttplug-biblioteket')));
    document.head.appendChild(s);
  });
}

function setDeviceState(text, on = false) {
  ui.deviceState.textContent = text;
  ui.deviceState.classList.toggle('on', on);
}

function setIntifaceState(text, on = false) {
  ui.intifaceState.textContent = text;
  ui.intifaceState.classList.toggle('on', on);
}

function motorCount(d) {
  return d.vibrateAttributes?.length || 0;
}

function canStroke(d) {
  return (d.linearAttributes?.length || 0) > 0;
}

function renderBpDevices() {
  updateVibModeLabel();
  $('vibStrengthField').hidden = !bpDevices.some((d) => !canStroke(d) && motorCount(d));
  ui.bpDevicesList.innerHTML = bpDevices.map((d) => {
    const what = canStroke(d) ? t('slag')
      : motorCount(d) > 1 ? t('vibration · {n} motorer', { n: motorCount(d) }) : motorCount(d) ? t('vibration') : t('ikke understøttet');
    return `<li><span>${escapeHtml(d.name)}</span><span class="what">${what}</span></li>`;
  }).join('');
  if (bpClient) setIntifaceState(bpDevices.length ? t(bpDevices.length > 1 ? '{n} enheder' : '{n} enhed', { n: bpDevices.length }) : t('Søger…'), bpDevices.length > 0);
}

async function toggleDevice() {
  if (bpClient) {
    saveJson('autoIntiface', false);
    try { await bpClient.disconnect(); } catch { /* ignore */ }
    bpClient = null;
    bpDevices = [];
    ui.connectBtn.textContent = t('Forbind');
    setIntifaceState(t('Ikke forbundet'));
    renderBpDevices();
    return;
  }
  ui.connectBtn.disabled = true;
  setIntifaceState(t('Forbinder…'));
  try {
    const bp = await loadButtplug();
    bpClient = new bp.ButtplugClient('Funscript Session');
    bpClient.addListener('deviceadded', (d) => {
      if (!bpDevices.includes(d)) bpDevices.push(d);
      renderBpDevices();
    });
    bpClient.addListener('deviceremoved', (d) => {
      bpDevices = bpDevices.filter((x) => x !== d);
      renderBpDevices();
    });
    bpClient.addListener('disconnect', () => {
      bpClient = null; bpDevices = []; ui.connectBtn.textContent = t('Forbind');
      setIntifaceState(t('Ikke forbundet')); renderBpDevices();
    });
    await bpClient.connect(new bp.ButtplugBrowserWebsocketClientConnector(ui.intifaceUrl.value.trim()));
    ui.connectBtn.textContent = t('Afbryd');
    saveJson('autoIntiface', true);
    bpDevices = [...bpClient.devices];
    renderBpDevices();
    await bpClient.startScanning();
    setTimeout(() => bpClient?.stopScanning().catch(() => {}), 15000);
  } catch (err) {
    console.warn(err);
    bpClient = null;
    setIntifaceState(t('Forbindelse fejlede'));
  } finally {
    ui.connectBtn.disabled = false;
  }
}

function mapPos(pos) {
  const lo = Number(ui.rangeMin.value);
  const hi = Number(ui.rangeMax.value);
  return clamp(lo + (hi - lo) * (pos / 100), 0, 100);
}

function send(promise) {
  Promise.resolve(promise).catch((err) => console.warn('Enhedsfejl', err));
}

/** Drive every Intiface device: strokers follow the stroke track, vibrators the vib track(s). */
function driveDevice(t) {
  if (!bpDevices.length || !state.playing || switching || !state.session || state.hold) return;
  const tt = t + Number(ui.offsetSlider.value);
  const { actions, vib, vib2 } = state.session;

  // strokers (OSR, or a Handy connected through Intiface)
  const i = upperBound(actions, tt);
  if (i !== deviceCursor && i < actions.length) {
    deviceCursor = i;
    const next = actions[i];
    const duration = Math.max(30, Math.round((next.at - tt) / state.rate));
    bpDevices.filter(canStroke).forEach((d) => send(d.linear(mapPos(next.pos) / 100, duration)));
  }

  // vibrators: Lovense & co. take ~10 commands/s, so only send real changes (and a keep-alive)
  const strength = Number(ui.vibStrength.value) / 100;
  const level1 = vib?.length ? clamp(positionAt(vib, tt) / 100 * strength, 0, 1) : 0;
  const level2 = vib2?.length ? clamp(positionAt(vib2, tt) / 100 * strength, 0, 1) : level1;
  const now = performance.now();
  bpDevices.filter((d) => !canStroke(d) && motorCount(d)).forEach((d) => {
    const levels = Array.from({ length: motorCount(d) }, (_, m) => (m === 1 ? level2 : level1));
    const last = d._sent || { levels: [], at: 0 };
    const changed = levels.some((v, m) => Math.abs(v - (last.levels[m] ?? -1)) >= 0.02);
    if (now - last.at < 100 || (!changed && now - last.at < 1000)) return;
    d._sent = { levels, at: now };
    send(d.vibrate(levels.length === 1 ? levels[0] : levels));
  });
}

function stopDevice() {
  deviceCursor = -1;
  bpDevices.forEach((d) => { d._sent = null; send(d.stop()); });
  handyToken += 1;
  if (Handy.connected) Handy.stop();
}

// ------------------------------------------------------------------ device (The Handy, direct)

let handyToken = 0;
let lastHandySync = 0;

function showHandyConnected(on) {
  $('handyBox').classList.toggle('connected', on);
  $('tempBox').hidden = !on;
}

async function toggleHandy() {
  if (Handy.connected) {
    Handy.disconnect();
    saveJson('autoHandy', false);
    showHandyConnected(false);
    ui.handyConnectBtn.textContent = t('Forbind');
    setDeviceState(t('Ikke forbundet'));
    return;
  }
  ui.handyConnectBtn.disabled = true;
  setDeviceState(t('Forbinder…'));
  try {
    await Handy.connect(ui.handyAppId.value, ui.handyKey.value);
    try {
      localStorage.setItem('handyAppId', ui.handyAppId.value.trim());
      localStorage.setItem('handyKey', ui.handyKey.value.trim());
    } catch { /* ignore */ }
    ui.handyConnectBtn.textContent = t('Afbryd');
    saveJson('autoHandy', true);
    setDeviceState(t('Handy forbundet'), true);
    showHandyConnected(true);
    Handy.setRange(Number(ui.rangeMin.value), Number(ui.rangeMax.value)).catch(() => {});
    if (state.session) prepareHandy();
  } catch (err) {
    setDeviceState(err.message);
  } finally {
    ui.handyConnectBtn.disabled = false;
  }
}

function prepareHandy() {
  setDeviceState(t('Sender script til Handy…'), true);
  Handy.prepare(state.session)
    .then(() => setDeviceState(t('Handy klar'), true))
    .catch((err) => setDeviceState(err.message));
}

/** Tell the Handy where we are in the session script (after play, seek, clip change or drift). */
async function handySync() {
  if (!Handy.connected || !state.playing || !state.session || state.hold || calib) return;
  const token = ++handyToken;
  lastHandySync = performance.now();
  try {
    await Handy.prepare(state.session);
    if (token !== handyToken || !state.playing) return;
    await Handy.play(state.sessionTime + Number(ui.offsetSlider.value), state.rate);
    setDeviceState(t('Handy spiller'), true);
  } catch (err) {
    setDeviceState(err.message);
  }
}

// Motor temperature: shown while connected; above the limit playback pauses and stays
// blocked until the motor has cooled TEMP_COOLDOWN degrees below the limit.
const TEMP_WARN_MARGIN = 10;
const TEMP_COOLDOWN = 8;
let lastTempPoll = 0;
let tempPolling = false;
let overheated = false;

async function pollTemp() {
  if (!Handy.connected || tempPolling) return;
  if (performance.now() - lastTempPoll < (state.playing || overheated ? 5000 : 15000)) return;
  lastTempPoll = performance.now();
  tempPolling = true;
  try {
    const temp = await Handy.motorTemp();
    if (temp === null) ui.tempValue.textContent = t('ikke tilgængelig');
    else showTemp(temp);
  } catch {
    // a missed reading is not an emergency; try again next round
  } finally {
    tempPolling = false;
  }
}

function showTemp(temp) {
  const limit = Number(ui.tempLimit.value);
  ui.tempValue.textContent = `${Math.round(temp)} °C`;
  ui.tempValue.classList.toggle('hot', temp >= limit);
  ui.tempValue.classList.toggle('warn', temp < limit && temp >= limit - TEMP_WARN_MARGIN);
  if (temp >= limit && !overheated) {
    overheated = true;
    if (state.playing) setPlaying(false);
    ui.tempStatus.textContent = t('For varm – pauset, køler af');
    setDeviceState(t('Handy køler af'));
  } else if (overheated && temp <= limit - TEMP_COOLDOWN) {
    overheated = false;
    ui.tempStatus.textContent = t('Kølet af – tryk ▶ for at fortsætte');
    setDeviceState(t('Handy klar'), true);
  } else if (!overheated) {
    ui.tempStatus.textContent = temp >= limit - TEMP_WARN_MARGIN ? t('Varm') : '';
  }
}

/** Resync when the Handy is ahead of or behind the video (seek, buffering, clip change). */
function checkHandyDrift(threshold = 250, minGap = 2000) {
  if (!Handy.connected || !state.playing || switching || state.hold) return;
  if (performance.now() - lastHandySync < minGap) return;
  const expected = Handy.expectedTime();
  const actual = state.sessionTime + Number(ui.offsetSlider.value);
  if (expected === null || Math.abs(expected - actual) > threshold) handySync();
}

// ------------------------------------------------------------------ events

ui.scanBtn.addEventListener('click', scanLibrary);
$('genAllBtn').addEventListener('click', () => toggleGenAll());
$('genRedoBtn').addEventListener('click', () => {
  if (confirm(t('Lav alle auto-scripts igen med den nyeste version? Det tager lidt tid. Originaler bliver ikke rørt.'))) toggleGenAll('redo');
});
$('genVibBtn').addEventListener('click', () => {
  if (confirm(t('Lav vib-scripts ud fra stroke-scriptet til alle videoer uden vib (ikke PMV)? Det går hurtigt. Originaler bliver ikke rørt.'))) toggleGenAll('vib');
});
$('genOpenBtn').addEventListener('click', () => api('/api/generate/open', { method: 'POST', body: {} }).catch((e) => alert(e.message)));
resumeUi.yes.addEventListener('click', resumeSession);
resumeUi.no.addEventListener('click', dismissResume);
window.addEventListener('pagehide', () => savePosition(true));
strip.rename.addEventListener('click', startRename);
strip.similar.addEventListener('click', () => state.session && buildSimilar(state.session.id));
strip.title.addEventListener('dblclick', startRename);
strip.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') finishRename(true);
  if (e.key === 'Escape') finishRename(false);
  e.stopPropagation();
});
strip.input.addEventListener('blur', () => finishRename(true));
$('gridBtn').addEventListener('click', openGrid);
grid.close.addEventListener('click', closeGrid);
grid.search.addEventListener('input', renderGrid);
grid.genre.addEventListener('change', renderGrid);
grid.actor.addEventListener('change', renderGrid);
grid.sort.value = loadJson('gridSort', 'name');
grid.sort.addEventListener('change', () => { saveJson('gridSort', grid.sort.value); renderGrid(); });
grid.usableOnly.addEventListener('change', () => { renderGenreOptions(); renderActorOptions(); renderGrid(); });
grid.all.addEventListener('change', () => {
  usableVideos().forEach((v) => (grid.all.checked ? state.deselected.delete(v.id) : state.deselected.add(v.id)));
  saveJson('deselected', [...state.deselected]);
  renderGrid();
});
ui.exportBtn.addEventListener('click', saveExportPath);
ui.remuxBtn.addEventListener('click', startRemux);
ui.librarySearch.addEventListener('input', renderLibrary);
ui.selectAll.addEventListener('change', () => {
  usableVideos().forEach((v) => (ui.selectAll.checked ? state.deselected.delete(v.id) : state.deselected.add(v.id)));
  saveJson('deselected', [...state.deselected]);
  renderLibrary();
  updateSpeedLabel();
});

ui.lengthChips.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  state.minutes = Number(b.dataset.v);
  ui.customMinutes.value = '';
  setChip(ui.lengthChips, b);
}));
ui.customMinutes.addEventListener('input', () => setChip(ui.lengthChips, null));
ui.curveChips.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  state.curve = b.dataset.v;
  setChip(ui.curveChips, b);
}));
document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  ui.speedSlider.value = b.dataset.speed;
  updateSpeedLabel();
}));
ui.speedSlider.addEventListener('input', updateSpeedLabel);
ui.warmupSlider.value = loadJson('warmupMinutes', 0);
const showWarmupLabel = () => {
  const m = Number(ui.warmupSlider.value);
  ui.warmupLabel.textContent = m ? `${m} min` : t('ingen');
};
showWarmupLabel();
ui.warmupSlider.addEventListener('input', () => { showWarmupLabel(); saveJson('warmupMinutes', Number(ui.warmupSlider.value)); });
ui.maxSpeedSlider.addEventListener('input', () => {
  const v = Number(ui.maxSpeedSlider.value);
  ui.maxSpeedLabel.textContent = v ? `${v} u/s` : t('ingen');
});
ui.vibMode.value = loadJson('vibMode2', 'auto');
ui.vibMode.addEventListener('change', () => { saveJson('vibMode2', ui.vibMode.value); updateVibModeLabel(); });
updateVibModeLabel();
ui.vibStrength.value = loadJson('vibStrength', 100);
ui.vibStrengthLabel.textContent = `${ui.vibStrength.value}%`;
ui.vibStrength.addEventListener('input', () => {
  ui.vibStrengthLabel.textContent = `${ui.vibStrength.value}%`;
  saveJson('vibStrength', Number(ui.vibStrength.value));
});
ui.smooth.checked = loadJson('smooth', true);
ui.smooth.addEventListener('change', () => saveJson('smooth', ui.smooth.checked));
ui.onlyFavs.checked = state.onlyFavs;
ui.onlyFavs.addEventListener('change', () => {
  state.onlyFavs = ui.onlyFavs.checked;
  saveJson('onlyFavs', state.onlyFavs);
  renderLibrary();
  updateSpeedLabel();
});
ui.tempLimit.value = loadJson('tempLimit', 70);
ui.tempLimitLabel.textContent = `${ui.tempLimit.value} °C`;
ui.tempLimit.addEventListener('input', () => {
  ui.tempLimitLabel.textContent = `${ui.tempLimit.value} °C`;
  saveJson('tempLimit', Number(ui.tempLimit.value));
  lastTempPoll = 0; // re-evaluate against the new limit right away
});
ui.rateSlider.addEventListener('input', () => setRate(Number(ui.rateSlider.value), false));
ui.rateSlider.addEventListener('change', () => setRate(Number(ui.rateSlider.value), true));
ui.buildBtn.addEventListener('click', buildSession);

ui.playBtn.addEventListener('click', togglePlay);
$('fullscreenBtn').addEventListener('click', toggleFullscreen);
fs.exit.addEventListener('click', toggleFullscreen);
fs.play.addEventListener('click', togglePlay);
fs.next.addEventListener('click', nextClip);
fs.progress.addEventListener('click', (e) => {
  if (!state.session) return;
  const rect = fs.progress.getBoundingClientRect();
  seekSession(((e.clientX - rect.left) / rect.width) * state.session.totalMs);
});
// click on the picture = play/pause, double-click = fullscreen (wait to tell them apart)
let clickTimer = null;
players.forEach((p) => {
  p.addEventListener('click', () => {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(togglePlay, 250);
  });
  p.addEventListener('dblclick', () => {
    clearTimeout(clickTimer);
    toggleFullscreen();
  });
});
videoWrap.addEventListener('mousemove', showFullscreenUi);
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement === videoWrap) showFullscreenUi();
  else videoWrap.classList.remove('show-ui');
});
ui.nextBtn.addEventListener('click', nextClip);
ui.moreBtn.addEventListener('click', () => { cue('more', true); steer('more'); });
ui.lessBtn.addEventListener('click', () => { cue('less', true); steer('less'); });
ui.finishBtn.addEventListener('click', () => { cue('finish', true); steer('finish'); });
ui.surpriseBtn.addEventListener('click', surpriseMe);
ui.cueBtn.addEventListener('click', toggleCoach);
ui.cueBtn.classList.toggle('on', coachOn);
ui.surprises.checked = loadJson('surprises', false);
ui.surprises.addEventListener('change', () => saveJson('surprises', ui.surprises.checked));
ui.cueVol.value = loadJson('cueVol', 0.6);
$('cueVolLabel').textContent = `${Math.round(ui.cueVol.value * 100)}%`;
ui.cueVol.addEventListener('input', () => {
  $('cueVolLabel').textContent = `${Math.round(ui.cueVol.value * 100)}%`;
  saveJson('cueVol', Number(ui.cueVol.value));
});
ui.cueMode.value = loadJson('cueMode', 'sounds');
showCueMode();
ui.cueMode.addEventListener('change', () => { saveJson('cueMode', ui.cueMode.value); showCueMode(); });
ui.voiceScan.addEventListener('click', scanVoices);
loadVoices();
$('cueTest').addEventListener('click', () => {
  const was = coachOn;
  coachOn = true;
  lastCoachAt = -Infinity;
  try { cue(['faster', 'pause', 'burst', 'finale'][Math.floor(Math.random() * 4)], true); } finally { coachOn = was; }
});
$('forgetBtn').addEventListener('click', forgetTaste);
ui.prevBtn.addEventListener('click', () => {
  const clip = state.session?.clips[state.clipIndex];
  if (clip && state.sessionTime - clip.offsetMs > 3000) goToClip(state.clipIndex, 0);
  else goToClip(state.clipIndex - 1);
});
ui.volume.addEventListener('input', applyVolume);
ui.levelBtn.addEventListener('click', toggleLevelAudio);
ui.timelineCanvas.addEventListener('click', (e) => {
  if (!state.session) return;
  const rect = ui.timelineCanvas.getBoundingClientRect();
  seekSession(((e.clientX - rect.left) / rect.width) * state.session.totalMs);
});

// ------------------------------------------------------------------ hold still
/** ✋: devices stand still while the video plays on (from the PC or the phone). */
function toggleHold(on = !state.hold) {
  state.hold = on;
  $('holdBtn').classList.toggle('on', on);
  if (on) {
    stopDevice();
  } else {
    deviceCursor = -1;
    handySync();
  }
}

// ------------------------------------------------------------------ phone remote
let remoteOn = false;
let remoteLoops = false;

function showRemote(info) {
  remoteOn = info.enabled;
  $('remoteOn').checked = info.enabled;
  $('remoteInfo').hidden = !info.enabled;
  $('remoteUrl').value = info.url || '';
  $('tvAddress').textContent = (info.url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const pill = $('remoteState');
  pill.textContent = info.error ? t('Fejl') : !info.enabled ? t('Slået fra')
    : info.phoneSeen ? t('Mobil forbundet') : t('Venter på mobil');
  pill.title = info.error || '';
  pill.classList.toggle('on', info.enabled && info.phoneSeen);
  if (info.enabled) startRemoteLoops();
}

async function setRemote(body) {
  try {
    showRemote(await api('/api/remote', { method: 'POST', body }));
  } catch (err) {
    alert(err.message);
  }
}

function startRemoteLoops() {
  if (remoteLoops) return;
  remoteLoops = true;
  (async () => {  // commands from the phone (long-poll)
    while (remoteOn) {
      try {
        const { commands } = await api('/api/remote/wait');
        commands.forEach(runRemote);
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    remoteLoops = false;
  })();
  (async () => {  // what the phone shows
    for (let n = 0; remoteOn; n += 1) {
      const s = state.session;
      const clip = s?.clips[state.clipIndex];
      api('/api/remote/status', { method: 'POST', body: {
        session: s?.name || '', clip: clip ? `${t('Klip {i}/{n}', { i: state.clipIndex + 1, n: s.clips.length })} · ${clip.name}` : '',
        time: state.sessionTime || 0, total: s?.totalMs || 0, playing: state.playing, hold: !!state.hold,
        rate: state.rate, volume: Number(ui.volume.value),
        edge: state.edge ? { edges: state.edge.edges, resting: state.edge.resting } : null,
      } }).catch(() => {});
      if (n % 10 === 9) api('/api/remote').then(showRemote).catch(() => {});
      if (n % 3 === 0) api('/api/tv/pending').then(showTvPair).catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
}

// ------------------------------------------------------------------ TV pairing (TvFin)
let tvPairId = null;

function showTvPair({ pending }) {
  const req = (pending || [])[0];
  tvPairId = req ? req.id : null;
  $('tvPair').hidden = !req;
  if (!req) return;
  $('tvPairCode').textContent = req.code;
  const hasHandy = !!(localStorage.getItem('handyAppId') && localStorage.getItem('handyKey'));
  $('tvPairHandy').disabled = !hasHandy;
  if (!hasHandy) $('tvPairHandy').checked = false;
}

async function answerTvPair(allow) {
  if (!tvPairId) return;
  const handy = allow && $('tvPairHandy').checked
    ? { appId: localStorage.getItem('handyAppId') || '', key: localStorage.getItem('handyKey') || '' } : null;
  try { await api('/api/tv/answer', { method: 'POST', body: { id: tvPairId, allow, handy } }); } catch { /* expired */ }
  tvPairId = null;
  $('tvPair').hidden = true;
}
$('tvPairAllow').addEventListener('click', () => answerTvPair(true));
$('tvPairDeny').addEventListener('click', () => answerTvPair(false));

function runRemote(command) {
  const volume = (step) => {
    ui.volume.value = clamp(Number(ui.volume.value) + step, 0, 1);
    ui.volume.dispatchEvent(new Event('input'));
    ui.volume.dispatchEvent(new Event('change'));
  };
  ({
    toggle: togglePlay,
    next: nextClip,
    prev: () => ui.prevBtn.click(),
    more: () => ui.moreBtn.click(),
    less: () => ui.lessBtn.click(),
    finish: () => ui.finishBtn.click(),
    faster: () => setRate(state.rate + 0.05, true),
    slower: () => setRate(state.rate - 0.05, true),
    louder: () => volume(0.1),
    quieter: () => volume(-0.1),
    hold: () => toggleHold(),
    edge: edgeNow,
    mark: markSpot,
  }[command] || (() => {}))();
}

$('remoteOn').addEventListener('change', () => setRemote({ enabled: $('remoteOn').checked }));
$('remoteNewKey').addEventListener('click', () => {
  if (confirm(t('Lav et nyt link? Det gamle link på mobilen holder op med at virke.'))) setRemote({ newKey: true });
});
$('remoteCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('remoteUrl').value); } catch { $('remoteUrl').select(); }
  $('remoteCopy').textContent = t('Kopieret');
  setTimeout(() => { $('remoteCopy').textContent = t('Kopiér link'); }, 1500);
});
api('/api/remote').then(showRemote).catch(() => {});

// ------------------------------------------------------------------ delay calibration
// A flash + click every second on the screen (or TV), and the Handy hits the bottom on each one;
// the user drags the delay until they happen together.
const CALIB_MS = 1000;
let calib = null;

function calibTime() { return performance.now() - calib.start; }
function calibOffset() { return Number($('calibSlider').value); }

function showCalibOffset() {
  const ms = calibOffset();
  $('calibLabel').textContent = ms < 0 ? t('{n} ms (venter på billedet)', { n: ms })
    : ms > 0 ? t('{n} ms (før billedet)', { n: `+${ms}` }) : '0 ms';
}

async function calibSync() {
  if (calib && Handy.connected) await Handy.play(calibTime() + calibOffset(), 1).catch(() => {});
}

function calibClick() {
  try {
    const ctx = cueContext();
    tone(ctx, ctx.destination, { f0: 1400, dur: 0.05, peak: 0.4, attack: 0.002 });
  } catch { /* no sound */ }
}

function calibFrame() {
  if (!calib) return;
  const now = calibTime();
  const beat = Math.floor(now / CALIB_MS);
  if (beat !== calib.beat) {  // the picture: flash + click
    calib.beat = beat;
    $('calibDot').classList.add('flash');
    calibClick();
    setTimeout(() => $('calibDot').classList.remove('flash'), 120);
  }
  const deviceBeat = Math.floor((now + calibOffset()) / CALIB_MS);
  if (deviceBeat !== calib.deviceBeat) {  // vibrators: a short pulse on their own (delayed) beat
    calib.deviceBeat = deviceBeat;
    const vibs = bpDevices.filter((d) => !canStroke(d) && motorCount(d));
    vibs.forEach((d) => send(d.vibrate(0.8)));
    if (vibs.length) setTimeout(() => vibs.forEach((d) => send(d.stop())), 150);
  }
}

async function openCalib() {
  if (!Handy.connected && !bpDevices.length) {
    alert(t('Forbind Handy eller en vibrator først'));
    return;
  }
  if (state.playing) setPlaying(false);
  const totalMs = 15 * 60 * 1000;
  const actions = [];
  for (let at = 0; at <= totalMs; at += CALIB_MS) {
    actions.push({ at, pos: 0 }, { at: at + CALIB_MS / 2, pos: 100 });
  }
  calib = { start: performance.now(), beat: -1, deviceBeat: -1, timer: 0 };
  $('calibSlider').value = ui.offsetSlider.value;
  showCalibOffset();
  $('calib').classList.remove('hidden');
  $('calib').requestFullscreen?.().catch(() => {});
  calib.timer = setInterval(calibFrame, 10); // a timer, not rAF: keeps going in a background tab
  if (Handy.connected) {
    $('calibStatus').textContent = t('Sender test-script til Handy…');
    try {
      await Handy.prepare({ id: 'calib', actions, totalMs });
      await calibSync();
      $('calibStatus').textContent = '';
    } catch (err) {
      $('calibStatus').textContent = err.message;
    }
  }
}

function closeCalib(save) {
  if (!calib) return;
  clearInterval(calib.timer);
  calib = null;
  $('calib').classList.add('hidden');
  if (document.fullscreenElement === $('calib')) document.exitFullscreen().catch(() => {});
  stopDevice();
  if (save) {
    ui.offsetSlider.value = $('calibSlider').value;
    ui.offsetSlider.dispatchEvent(new Event('input'));
    ui.offsetSlider.dispatchEvent(new Event('change'));
  }
}

function nudgeCalib(step) {
  $('calibSlider').value = Number($('calibSlider').value) + step;
  showCalibOffset();
  calibSync();
}

$('calibBtn').addEventListener('click', openCalib);
$('calibSlider').addEventListener('input', showCalibOffset);
$('calibSlider').addEventListener('change', calibSync);
$('calibMinus').addEventListener('click', () => nudgeCalib(-20));
$('calibPlus').addEventListener('click', () => nudgeCalib(20));
$('calibDone').addEventListener('click', () => closeCalib(true));
$('calibCancel').addEventListener('click', () => closeCalib(false));
$('holdBtn').addEventListener('click', () => toggleHold());
// ------------------------------------------------------------------ ⭐ favourite spots
/** B / ⭐: remember the spot playing now; sessions then like to use that part of the video. */
async function markSpot() {
  const clip = state.session?.clips[state.clipIndex];
  if (!clip) return;
  const at = Math.round(players[active].currentTime * 1000);
  const v = videoInfo(clip.videoId);
  try {
    const { id } = await api(`/api/videos/${clip.videoId}/marks`, { method: 'POST', body: { at } });
    if (v) v.marks = [...(v.marks || []), at];
    $('markBtn').classList.add('flash');
    setTimeout(() => $('markBtn').classList.remove('flash'), 600);
    showToast(t('⭐ Sted markeret ({time} i "{name}")', { time: fmtTime(at), name: v?.title || clip.name }), {
      undo: () => {
        api(`/api/marks/${id}/delete`, { method: 'POST', body: {} }).catch(() => {});
        if (v) v.marks = (v.marks || []).filter((m) => m !== at);
      },
    });
  } catch (err) {
    showToast(err.message);
  }
}

// ------------------------------------------------------------------ ∞ endless
// Shortly before the end a similar session (other clips) is built; at the end it takes over.
state.endless = loadJson('endless', false);
let endlessNext = null;
let endlessBusy = false;

function showEndless() {
  $('endlessBtn').classList.toggle('on', state.endless);
}

function endlessTick() {
  const s = state.session;
  if (!state.endless || !state.playing || !s || endlessBusy || endlessNext?.from === s.id) return;
  if (s.totalMs - state.sessionTime > 90000) return;
  endlessBusy = true;
  api(`/api/sessions/${s.id}/similar`, { method: 'POST', body: { seed: Math.floor(Math.random() * 1e9) } })
    .then((next) => { endlessNext = { from: s.id, session: next }; loadSessions(); })
    .catch(() => {})
    .finally(() => { endlessBusy = false; });
}

/** At the end of a session: go on with the prepared one. Returns true when it did. */
function endlessContinue() {
  if (!state.endless || endlessNext?.from !== state.session?.id) return false;
  const next = endlessNext.session;
  endlessNext = null;
  showToast(t('∞ Fortsætter med nye klip'));
  openSession(next).then(() => setPlaying(true));
  return true;
}

$('endlessBtn').addEventListener('click', () => {
  state.endless = !state.endless;
  saveJson('endless', state.endless);
  showEndless();
  showToast(state.endless ? t('∞ Uendelig: fortsætter med nye klip, når sessionen slutter') : t('∞ Uendelig er slået fra'));
});
showEndless();

// ------------------------------------------------------------------ 🎯 edge game
// Builds up; "tæt på" holds the devices still for a rest that grows each time, then the coming
// clips are re-picked calmer and it builds up again. The result goes into the statistics.
state.edge = null;

function renderEdge() {
  const e = state.edge;
  $('edgePanel').hidden = !e;
  if (!e) return;
  $('edgeCount').textContent = `🎯 ${e.edges}`;
  $('edgeNowBtn').disabled = e.resting > 0;
  $('edgeNowBtn').textContent = e.resting > 0 ? t('Hvil {n} s', { n: e.resting }) : `😮 ${t('Tæt på')}`;
  $('edgeText').textContent = e.resting > 0 ? t('Pause. Den bygger op igen bagefter.')
    : e.edges ? t('{n} gange indtil nu. Længst uden pause: {time}', { n: e.edges, time: fmtTime(e.longest * 1000) })
      : t('Tryk når du er tæt på – så holder den pause og bygger op igen.');
}

async function startEdgeGame() {
  const built = await buildSession({ curve: 'ramp' });
  if (!built) return;
  state.edge = { edges: 0, started: performance.now(), lastEdge: performance.now(), longest: 0, resting: 0, timer: 0 };
  renderEdge();
  showToast(t('🎯 Edge-spil: tryk ▶ for at starte. Tryk "Tæt på" (E) når du er tæt på.'));
}

function edgeNow() {
  const e = state.edge;
  if (!e || e.resting > 0 || !state.playing) return;
  const now = performance.now();
  e.edges += 1;
  e.longest = Math.max(e.longest, Math.round((now - e.lastEdge) / 1000));
  e.resting = Math.min(60, 15 + 5 * e.edges);
  toggleHold(true);
  cue('pause', true);
  renderEdge();
  e.timer = setInterval(() => {
    e.resting -= 1;
    if (e.resting <= 0) {
      clearInterval(e.timer);
      e.resting = 0;
      e.lastEdge = performance.now();
      toggleHold(false);
      steer('less');  // the next clips calmer, the session builds up again from there
    }
    renderEdge();
  }, 1000);
}

function endEdgeGame() {
  const e = state.edge;
  if (!e) return;
  clearInterval(e.timer);
  if (e.resting > 0) toggleHold(false);
  state.edge = null;
  renderEdge();
  const seconds = Math.round((performance.now() - e.started) / 1000);
  if (e.edges || seconds > 60) {
    api('/api/stats/edge', { method: 'POST', body: { edges: e.edges, seconds, longest: e.longest } }).catch(() => {});
    showToast(t('🎯 {n} gange tæt på på {time}. Længst uden pause: {long}', {
      n: e.edges, time: fmtTime(seconds * 1000), long: fmtTime(e.longest * 1000) }), { ms: 12000 });
  }
}

$('edgeBtn').addEventListener('click', startEdgeGame);
$('edgeNowBtn').addEventListener('click', edgeNow);
$('edgeEndBtn').addEventListener('click', endEdgeGame);

// ------------------------------------------------------------------ 📊 statistics + backup
let playTicked = 0;
setInterval(() => {  // played time, in 30 s steps
  if (!state.playing) return;
  playTicked += 30;
  api('/api/stats/tick', { method: 'POST', body: { seconds: 30 } }).catch(() => {});
}, 30000);

function fmtHours(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} t ${m} min` : `${m} min`;
}

async function openStats() {
  $('statsDialog').showModal();
  $('statsBody').textContent = t('Henter…');
  try {
    const s = await api('/api/stats');
    const weekMax = Math.max(60, ...s.week.map((d) => d.seconds));
    const dayName = (d) => new Date(`${d}T12:00`).toLocaleDateString(LANG === 'da' ? 'da-DK' : 'en-GB', { weekday: 'short' });
    const fb = s.feedback || {};
    const finished = fb.complete || 0;
    const skipped = (fb.skip || 0) + (fb.swap || 0) + (fb.remove || 0);
    const best = s.edgeGames.reduce((b, g) => (g.edges > (b?.edges ?? -1) ? g : b), null);
    const list = (items, label) => (items.length
      ? `<ol class="stat-list">${items.map(label).join('')}</ol>` : `<p class="hint">${t('Intet endnu')}</p>`);
    $('statsBody').innerHTML = `
      <div class="stat-tiles">
        <div class="stat-tile"><b>${fmtHours(s.totalSeconds)}</b><span>${t('spilletid i alt')}</span></div>
        <div class="stat-tile"><b>${fmtHours(s.week.reduce((a, d) => a + d.seconds, 0))}</b><span>${t('de sidste 7 dage')}</span></div>
        <div class="stat-tile"><b>${s.sessions}</b><span>${t('sessioner bygget · {n} afspillet', { n: s.sessionsPlayed })}</span></div>
        <div class="stat-tile"><b>${s.videosUsed} / ${s.videosUsable}</b><span>${t('videoer brugt')}</span></div>
        <div class="stat-tile"><b>${finished ? Math.round((finished / (finished + skipped)) * 100) : 0}%</b><span>${t('klip set færdig ({a} færdig, {b} sprunget over)', { a: finished, b: skipped })}</span></div>
        <div class="stat-tile"><b>⭐ ${s.marks}</b><span>${t('markerede steder')}</span></div>
        ${best ? `<div class="stat-tile"><b>🎯 ${best.edges}</b><span>${t('bedste edge-spil ({n} spil i alt)', { n: s.edgeGames.length })}</span></div>` : ''}
      </div>
      <h4 class="stats-h">${t('Spilletid de sidste 7 dage')}</h4>
      <div class="week">${s.week.map((d) => `<div title="${fmtHours(d.seconds)}"><span>${d.seconds >= 60 ? Math.round(d.seconds / 60) : ''}</span><i style="height:${(d.seconds / weekMax) * 80}%"></i>${dayName(d.day)}</div>`).join('')}</div>
      <div class="help-cols">
        <div><h4 class="stats-h">${t('Mest brugte videoer')}</h4>
          ${list(s.topVideos, (v) => `<li>${escapeHtml(v.title)} <span class="n">${v.plays}×</span></li>`)}</div>
        <div><h4 class="stats-h">${t('Mest brugte kategorier')}</h4>
          ${list(s.topCategories, (c) => `<li>${escapeHtml(t(c.name))} <span class="n">${c.plays}×</span></li>`)}
          <h4 class="stats-h">${t('Appen har lært, at du kan lide')}</h4>
          ${list(s.liked, (v) => `<li>${escapeHtml(v.title)}</li>`)}</div>
      </div>
      ${s.edgeGames.length ? `<h4 class="stats-h">${t('Seneste edge-spil')}</h4>
        ${list(s.edgeGames.slice(0, 5), (g) => `<li>${new Date(g.at * 1000).toLocaleDateString(LANG === 'da' ? 'da-DK' : 'en-GB')}: 🎯 ${g.edges} · ${fmtTime(g.seconds * 1000)} · ${t('længst uden pause {t}', { t: fmtTime(g.longest * 1000) })}</li>`)}` : ''}`;
  } catch (err) {
    $('statsBody').textContent = err.message;
  }
}

const BROWSER_SKIP = ['handyAppId', 'handyKey'];  // keys stay in this browser only

async function saveBackup() {
  try {
    const data = await api('/api/backup');
    const browser = {};
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!BROWSER_SKIP.includes(key)) browser[key] = localStorage.getItem(key);
      }
    } catch { /* no storage */ }
    data.browser = browser;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `funscript-session-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast(t('Backup gemt i din Overførsler-mappe'));
  } catch (err) {
    showToast(err.message);
  }
}

async function restoreBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    const { restored } = await api('/api/restore', { method: 'POST', body: { backup: data } });
    try {
      Object.entries(data.browser || {}).forEach(([k, v]) => { if (!BROWSER_SKIP.includes(k)) localStorage.setItem(k, v); });
    } catch { /* no storage */ }
    showToast(t('Gendannet: {s} sessioner, {v} videoer, {m} ⭐-steder. Genindlæser…', {
      s: restored.sessions, v: restored.videos, m: restored.marks }));
    setTimeout(() => location.reload(), 2000);
  } catch (err) {
    showToast(err instanceof SyntaxError ? t('Filen er ikke en backup') : err.message);
  }
}

$('statsBtn').addEventListener('click', openStats);
$('statsClose').addEventListener('click', () => $('statsDialog').close());
$('backupBtn').addEventListener('click', saveBackup);
$('restoreBtn').addEventListener('click', () => $('restoreFile').click());
$('restoreFile').addEventListener('change', () => {
  const file = $('restoreFile').files[0];
  $('restoreFile').value = '';
  if (file) restoreBackup(file);
});
$('markBtn').addEventListener('click', markSpot);

// ------------------------------------------------------------------ toast with "Fortryd"
let toastTimer = null;
let toastDone = null;

/** A short message at the bottom; with `undo` it has a Fortryd button. `onTimeout` runs when it
 *  goes away without being undone (used to delay deletions until the user had a chance). */
function showToast(text, { undo = null, onTimeout = null, ms = 6000 } = {}) {
  finishToast();  // a previous delayed action happens now
  $('toastText').textContent = text;
  $('toastUndo').hidden = !undo;
  $('toast').classList.remove('hidden');
  toastDone = { undo, onTimeout };
  toastTimer = setTimeout(finishToast, ms);
}

function finishToast(undone = false) {
  clearTimeout(toastTimer);
  const done = toastDone;
  toastDone = null;
  $('toast').classList.add('hidden');
  if (!done) return;
  if (undone) done.undo?.();
  else done.onTimeout?.();
}

$('toastUndo').addEventListener('click', () => finishToast(true));
window.addEventListener('beforeunload', () => finishToast());  // a pending deletion still happens

// ------------------------------------------------------------------ saved set-ups (presets)
const PRESET_FIELDS = ['minutes', 'custom', 'curve', 'speed', 'maxSpeed', 'clip', 'warmup', 'surprises', 'smooth',
  'onlyFavs', 'vibMode', 'categories'];

function currentSetup() {
  return {
    minutes: state.minutes, custom: Number(ui.customMinutes.value) || 0, curve: state.curve,
    speed: Number(ui.speedSlider.value), maxSpeed: Number(ui.maxSpeedSlider.value), clip: ui.clipLength.value,
    warmup: Number(ui.warmupSlider.value), surprises: ui.surprises.checked, smooth: ui.smooth.checked,
    onlyFavs: !!state.onlyFavs, vibMode: ui.vibMode.value, categories: [...state.categories],
  };
}

function setupName(p) {
  const minutes = p.custom || p.minutes;
  const curve = ui.curveChips.querySelector(`[data-v="${p.curve}"]`)?.textContent || p.curve;
  const cats = p.categories.length ? ` · ${p.categories.map((c) => t(c)).join(', ')}` : '';
  return `${minutes} min · ${curve.trim()}${cats}`;
}

function applySetup(p) {
  const chip = ui.lengthChips.querySelector(`[data-v="${p.minutes}"]`);
  if (chip) chip.click();
  ui.customMinutes.value = p.custom || '';
  if (p.custom) setChip(ui.lengthChips, null);
  ui.curveChips.querySelector(`[data-v="${p.curve}"]`)?.click();
  ui.speedSlider.value = p.speed;
  updateSpeedLabel();
  ui.maxSpeedSlider.value = p.maxSpeed;
  ui.maxSpeedSlider.dispatchEvent(new Event('input'));
  ui.clipLength.value = p.clip;
  ui.warmupSlider.value = p.warmup;
  ui.warmupSlider.dispatchEvent(new Event('input'));
  [[ui.surprises, p.surprises], [ui.smooth, p.smooth], [$('onlyFavs'), p.onlyFavs]].forEach(([box, on]) => {
    if (box.checked !== !!on) { box.checked = !!on; box.dispatchEvent(new Event('change')); }
  });
  ui.vibMode.value = p.vibMode;
  ui.vibMode.dispatchEvent(new Event('change'));
  setCategories(p.categories.filter((c) => state.library.some((v) => videoCats(v).includes(c))));
}

function renderPresets() {
  const list = loadJson('presets', []);
  const box = $('presets');
  box.innerHTML = '';
  list.forEach((p, i) => {
    const chip = document.createElement('span');
    chip.className = 'preset';
    chip.innerHTML = `<button class="go" title="${t('Byg med denne opsætning')}">▶ ${escapeHtml(p.name)}</button>`
      + `<button class="x" title="${t('Fjern')}">✕</button>`;
    chip.querySelector('.go').addEventListener('click', () => { applySetup(p); buildSession(); });
    chip.querySelector('.x').addEventListener('click', () => {
      const all = loadJson('presets', []);
      all.splice(i, 1);
      saveJson('presets', all);
      renderPresets();
      showToast(t('Opsætningen "{name}" er fjernet', { name: p.name }), {
        undo: () => { const back = loadJson('presets', []); back.splice(i, 0, p); saveJson('presets', back); renderPresets(); },
      });
    });
    box.appendChild(chip);
  });
  const add = document.createElement('span');
  add.className = 'preset add';
  add.innerHTML = `<button title="${t('Gem dine valg herover som en knap, der bygger med ét tryk')}">＋ ${t('Gem opsætning')}</button>`;
  add.querySelector('button').addEventListener('click', () => {
    const setup = currentSetup();
    const name = prompt(t('Navn til opsætningen:'), setupName(setup));
    if (!name || !name.trim()) return;
    const all = loadJson('presets', []);
    all.push({ ...setup, name: name.trim().slice(0, 40) });
    saveJson('presets', all);
    renderPresets();
    showToast(t('Gemt. Tryk på "{name}" for at bygge med det.', { name: name.trim() }));
  });
  box.appendChild(add);
}

// ------------------------------------------------------------------ help
function openHelp() {
  if (!$('helpDialog').open) $('helpDialog').showModal();
}
$('helpBtn').addEventListener('click', openHelp);
$('helpClose').addEventListener('click', () => $('helpDialog').close());

// ------------------------------------------------------------------ connect automatically
/** Handy and Intiface reconnect at start when they were connected last time ("Afbryd" stops it). */
function autoConnect() {
  if (loadJson('autoHandy', false) && ui.handyAppId.value && ui.handyKey.value && !Handy.connected) toggleHandy();
  if (loadJson('autoIntiface', false) && !bpClient) toggleDevice();
}

ui.connectBtn.addEventListener('click', toggleDevice);
ui.handyConnectBtn.addEventListener('click', toggleHandy);
// Delay between picture and devices. Mirroring to a TV (Win+K) shows the picture later, so the
// TV mode has its own saved delay (negative = devices wait for the picture).
const TV_DEFAULT_OFFSET = -250;
function offsetKey() { return $('tvMode').checked ? 'offsetTv' : 'offsetPc'; }
function showOffset() {
  const ms = Number(ui.offsetSlider.value);
  ui.offsetLabel.textContent = ms < 0 ? t('{n} ms (venter på billedet)', { n: ms })
    : ms > 0 ? t('{n} ms (før billedet)', { n: `+${ms}` }) : '0 ms';
  $('tvHint').classList.toggle('hidden', !$('tvMode').checked);
}
function loadOffset() {
  ui.offsetSlider.value = loadJson(offsetKey(), $('tvMode').checked ? TV_DEFAULT_OFFSET : 0);
  showOffset();
}
$('tvMode').checked = loadJson('tvMode', false);
loadOffset();
$('tvMode').addEventListener('change', () => {
  saveJson('tvMode', $('tvMode').checked);
  loadOffset();
  handySync();
});
ui.offsetSlider.addEventListener('input', showOffset);
ui.offsetSlider.addEventListener('change', () => { saveJson(offsetKey(), Number(ui.offsetSlider.value)); handySync(); });
// Stroke range: remembered between visits (it used to reset to 0–100 on every reload)
[ui.rangeMin, ui.rangeMax].forEach((el) => el.addEventListener('change', () => {
  saveJson('strokeRange', [Number(ui.rangeMin.value), Number(ui.rangeMax.value)]);
  Handy.setRange(Number(ui.rangeMin.value), Number(ui.rangeMax.value)).catch(() => {});
}));
[ui.rangeMin, ui.rangeMax].forEach((el) => el.addEventListener('input', () => {
  if (Number(ui.rangeMin.value) > Number(ui.rangeMax.value) - 5) {
    if (el === ui.rangeMin) ui.rangeMin.value = Number(ui.rangeMax.value) - 5;
    else ui.rangeMax.value = Number(ui.rangeMin.value) + 5;
  }
  ui.rangeLabel.textContent = `${ui.rangeMin.value} – ${ui.rangeMax.value}`;
}));
(() => {
  const [lo, hi] = loadJson('strokeRange', [0, 100]);
  ui.rangeMin.value = clamp(Number(lo) || 0, 0, 95);
  ui.rangeMax.value = clamp(Number(hi) || 100, Number(ui.rangeMin.value) + 5, 100);
  ui.rangeLabel.textContent = `${ui.rangeMin.value} – ${ui.rangeMax.value}`;
})();

document.addEventListener('keydown', (e) => {
  if (meta.dialog.open || $('helpDialog').open || $('statsDialog').open) return; // dialogs handle their own keys (Esc closes them)
  if (e.key === '?' && !e.target.matches('input, textarea')) { e.preventDefault(); openHelp(); return; }
  if (calib) {
    if (e.code === 'Escape') closeCalib(false);
    if (e.code === 'ArrowLeft') nudgeCalib(-20);
    if (e.code === 'ArrowRight') nudgeCalib(20);
    return;
  }
  if (gridOpen()) {
    if (e.code === 'Escape') closeGrid();
    return;
  }
  if (e.target.matches('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight') seekSession(state.sessionTime + 10000);
  if (e.code === 'ArrowLeft') seekSession(state.sessionTime - 10000);
  if (e.code === 'KeyN') nextClip();
  if (e.code === 'ArrowUp') { e.preventDefault(); steer('more'); }
  if (e.code === 'ArrowDown') { e.preventDefault(); steer('less'); }
  if (e.code === 'KeyF') toggleFullscreen();
  if (e.code === 'KeyH') toggleHold();
  if (e.code === 'KeyB') markSpot();
  if (e.code === 'KeyE') edgeNow();
  if (e.code === 'BracketLeft') setRate(state.rate - 0.05, true);
  if (e.code === 'BracketRight') setRate(state.rate + 0.05, true);
});
window.addEventListener('resize', () => { envelope = null; });

(async function init() {
  translatePage();
  document.querySelectorAll('details[data-key]').forEach((d) => {
    d.open = loadJson(d.dataset.key, false);
    d.addEventListener('toggle', () => saveJson(d.dataset.key, d.open));
  });
  document.querySelectorAll('[data-lang]').forEach((b) => {
    b.classList.toggle('on', b.dataset.lang === LANG);
    b.addEventListener('click', () => { if (b.dataset.lang !== LANG) setLanguage(b.dataset.lang); });
  });
  try {
    ui.handyAppId.value = localStorage.getItem('handyAppId') || '';
    ui.handyKey.value = localStorage.getItem('handyKey') || '';
  } catch { /* ignore */ }
  try {
    await loadSettings();
    await Promise.all([loadLibrary(), loadSessions()]);
    offerResume();
    renderPresets();
    autoConnect();
    api('/api/generate/status').then((s) => { if (s.running && s.all) pollGenAll(); }).catch(() => {});
    watchAudioMeasuring();
    applyVolume();
    api('/api/remux/status').then((s) => { if (s.running) pollRemux(); }).catch(() => {});
  } catch (err) {
    ui.scanStatus.textContent = t('Kan ikke nå serveren: {msg}', { msg: err.message });
    ui.scanStatus.classList.add('error');
  }
  setInterval(tick, 20);
  setInterval(pollTemp, 1000);
  requestAnimationFrame(frame);
})();
