/**
 * Danish / English. Danish is the source language: every text in the app is written in Danish
 * and EN maps it to English. Static HTML is translated by walking the page once at load
 * (text nodes plus title/placeholder/aria-label); dynamic texts go through t().
 * Switching language reloads the page.
 */
const EN = {
  // ---- static page
  'Bibliotek': 'Library',
  'D:\\Videoer': 'D:\\Videos',
  'Videoer matches med scripts på filnavn (Video.mp4 → Video.funscript)': 'Videos are matched with scripts by file name (Video.mp4 → Video.funscript)',
  'Konverter MPEG-TS': 'Convert MPEG-TS',
  'Videoer': 'Videos',
  'alle': 'all',
  '⊞ Vis store billeder': '⊞ Show large pictures',
  'Søg…': 'Search…',
  'Byg eller vælg en session for at starte': 'Build or pick a session to start',
  'Afspil / pause (mellemrum)': 'Play / pause (space)',
  'Næste klip (N)': 'Next clip (N)',
  'Klik for at spole': 'Click to seek',
  'Afslut fuldskærm (F / Esc)': 'Exit fullscreen (F / Esc)',
  'Forrige klip': 'Previous clip',
  'Næste klip': 'Next clip',
  'Tempo for video og Handy ( [ og ] )': 'Tempo for video and Handy ( [ and ] )',
  'Tempo': 'Tempo',
  'Lydstyrke': 'Volume',
  'Fuldskærm (F eller dobbeltklik på videoen)': 'Fullscreen (F or double-click the video)',
  'Omdøb session': 'Rename session',
  'Ny session': 'New session',
  'Længde': 'Length',
  'andet': 'other',
  'Tid per video': 'Time per video',
  'Auto (fordel ligeligt, min. 1 min)': 'Auto (spread evenly, min. 1 min)',
  '30 sek': '30 sec',
  'Hastighed': 'Speed',
  'auto': 'auto',
  'Auto': 'Auto',
  'Langsom': 'Slow',
  'Medium': 'Medium',
  'Hurtig': 'Fast',
  'Maks hastighed': 'Max speed',
  'ingen': 'none',
  'Kategorier': 'Categories',
  'Kun favoritter ★': 'Favourites only ★',
  'Fra = scriptet er 100% som dine filer, også ved klipskift': 'Off = the script is 100% your files, also at clip changes',
  'Glidende overgange mellem klip': 'Smooth transitions between clips',
  'Vibration (Lovense m.fl.)': 'Vibration (Lovense etc.)',
  'Automatisk – kun når en vibrator er forbundet': 'Automatic – only when a vibrator is connected',
  'Ingen vibration (kun Handy/slag)': 'No vibration (Handy/strokes only)',
  'Brug .vib-script – afled af slag, hvor det mangler': 'Use .vib script – derive from strokes where missing',
  'Kun videoer med .vib-script (100% original)': 'Only videos with a .vib script (100% original)',
  'Forløb': 'Pattern',
  'Konstant': 'Constant',
  'Opbygning': 'Build-up',
  'Bølger': 'Waves',
  'Edging': 'Edging',
  'Finale': 'Finale',
  'Hele turen': 'Full journey',
  'Opbygning → Bølger → Edging → Finale': 'Build-up → Waves → Edging → Finale',
  'Byg session': 'Build session',
  'Gemte sessioner': 'Saved sessions',
  'Gem scripts automatisk i': 'Save scripts automatically to',
  'Gem': 'Save',
  'Hver ny session gemmes her som .funscript': 'Every new session is saved here as .funscript',
  'Enheder': 'Devices',
  'Handy direkte': 'Handy direct',
  'Ikke forbundet': 'Not connected',
  'Forbindelseskode': 'Connection key',
  'Forbind': 'Connect',
  'Firmware 4: Application ID får du gratis på': 'Firmware 4: get a free Application ID at',
  ", forbindelseskoden står i Handy-appen. Scriptet uploades til Handys server og afspilles af Handy'en selv.":
    '; the connection key is in the Handy app. The script is uploaded to Handy\'s server and played by the Handy itself.',
  'Pause ved': 'Pause at',
  'Intiface – vibratorer m.fl.': 'Intiface – vibrators etc.',
  "Start Intiface Central, tænd legetøjet (fx Lovense Edge, Gush 2) og tryk Forbind. Vibratorer følger sessionens .vib-script (motor 2 bruger .vib2, hvis det findes). Kan køre samtidig med Handy'en.":
    'Start Intiface Central, switch on the toy (eg. Lovense Edge, Gush 2) and press Connect. Vibrators follow the session\'s .vib script (motor 2 uses .vib2 when there is one). Can run together with the Handy.',
  'Vib-styrke': 'Vibration strength',
  'Fælles': 'Shared',
  'Forsinkelse': 'Delay',
  'Slag-område': 'Stroke range',
  'Vælg videoer': 'Choose videos',
  'Søg titel, skuespiller, genre…': 'Search title, actor, genre…',
  'Genre': 'Genre',
  'Alle genrer': 'All genres',
  'Sortering': 'Sort order',
  'Navn': 'Name',
  'Favoritter først': 'Favourites first',
  'Langsomst først': 'Slowest first',
  'Hurtigst først': 'Fastest first',
  'Længst først': 'Longest first',
  'Mindst afspillet': 'Least played',
  'vælg alle': 'select all',
  'skjul uden script': 'hide without script',
  'Færdig': 'Done',
  'Klik på et billede for at vælge/fravælge det til sessioner · ★ = favorit · 👎 = brug aldrig · Esc lukker':
    'Click a picture to include/exclude it from sessions · ★ = favourite · 👎 = never use · Esc closes',

  // ---- library and builder
  'Gemt – sessioner skrives nu til denne mappe': 'Saved – sessions are now written to this folder',
  'Alle': 'All',
  'Løse filer': 'Loose files',
  '{n} videoer': '{n} videos',
  'Ingen match': 'No match',
  'Ingen videoer endnu – vælg en mappe og tryk Scan': 'No videos yet – choose a folder and press Scan',
  'MPEG-TS – skal konverteres': 'MPEG-TS – needs converting',
  'kan ikke afspilles i browser': "can't play in the browser",
  'kan ikke afspilles': "can't play",
  'intet script': 'no script',
  'fravalgt': 'excluded',
  'Har {x}-script': 'Has {x} script',
  'Favorit – foretrækkes i sessioner': 'Favourite – preferred in sessions',
  'Fravælg – bruges aldrig i sessioner': 'Exclude – never used in sessions',
  'Favorit': 'Favourite',
  'Brug aldrig': 'Never use',
  '{a} valgt · {b} vist': '{a} selected · {b} shown',
  'Scanner… {a}/{b}': 'Scanning… {a}/{b}',
  '{found} videoer · {added} nye · {updated} opdateret · {removed} fjernet': '{found} videos · {added} new · {updated} updated · {removed} removed',
  'Konverter MPEG-TS ({n})': 'Convert MPEG-TS ({n})',
  'Konverterer {a}/{b}: {name} · {pct}%': 'Converting {a}/{b}: {name} · {pct}%',
  'Fejlede: {list}': 'Failed: {list}',
  '{n} videoer er MPEG-TS og kan ikke afspilles direkte. Konvertering kopierer dem (uden genkodning) til en lokal cache; originalerne røres ikke.':
    "{n} videos are MPEG-TS and can't be played directly. Converting copies them (without re-encoding) to a local cache; the originals are not touched.",
  '{n} er allerede konverteret.': '{n} are already converted.',
  'nu: kun slag': 'now: strokes only',
  'nu: med vibration': 'now: with vibration',
  'auto (≈{n} u/s)': 'auto (≈{n} u/s)',
  'Vælg mindst én video med script': 'Choose at least one video with a script',
  'Bygger…': 'Building…',
  '{a} klip fra {b} videoer': '{a} clips from {b} videos',
  'Ingen sessioner endnu': 'No sessions yet',
  'klip': 'clips',
  'afspillet {n}×': 'played {n}×',
  '✓ gemt': '✓ saved',
  'Download samlet .funscript': 'Download combined .funscript',
  'Download vibrations-script (.vib.funscript)': 'Download vibration script (.vib.funscript)',
  'Omdøb': 'Rename',
  'Slet': 'Delete',
  'Nyt navn til sessionen:': 'New name for the session:',
  'Slet "{name}"?': 'Delete "{name}"?',

  // ---- playback
  'Kunne ikke indlæse {name}': "Couldn't load {name}",
  'Køler stadig af – vent lidt': 'Still cooling down – wait a moment',
  'Klip {i}/{n}': 'Clip {i}/{n}',
  'original': 'original',
  'afledt': 'derived',
  '{n} klip · {v} videoer · {time}': '{n} clips · {v} videos · {time}',
  '{range} i videoen': '{range} in the video',
  'Byt med et andet klip i samme hastighed': 'Swap for another clip at the same speed',
  'Fjern klip fra sessionen': 'Remove clip from the session',
  'Opdaterer session…': 'Updating session…',
  'En session skal have mindst ét klip': 'A session needs at least one clip',
  '⚠ Handy køler af': '⚠ Handy cooling down',

  // ---- devices
  'Kunne ikke hente buttplug-biblioteket': "Couldn't load the buttplug library",
  'slag': 'strokes',
  'vibration · {n} motorer': 'vibration · {n} motors',
  'vibration': 'vibration',
  'ikke understøttet': 'not supported',
  '{n} enhed': '{n} device',
  '{n} enheder': '{n} devices',
  'Søger…': 'Searching…',
  'Forbinder…': 'Connecting…',
  'Afbryd': 'Disconnect',
  'Forbindelse fejlede': 'Connection failed',
  'Handy forbundet': 'Handy connected',
  'Sender script til Handy…': 'Sending script to Handy…',
  'Handy klar': 'Handy ready',
  'Handy spiller': 'Handy playing',
  'ikke tilgængelig': 'not available',
  'For varm – pauset, køler af': 'Too hot – paused, cooling down',
  'Handy køler af': 'Handy cooling down',
  'Kølet af – tryk ▶ for at fortsætte': 'Cooled down – press ▶ to continue',
  'Varm': 'Warm',
  'Kan ikke nå serveren: {msg}': "Can't reach the server: {msg}",
  'Ugyldigt Application ID': 'Invalid Application ID',
  'Handy er ikke online – tjek at den er på WiFi': 'Handy is not online – check that it is on WiFi',
  'Handy-fejl (HTTP {status})': 'Handy error (HTTP {status})',
  'Indtast dit Application ID (user.handyfeeling.com)': 'Enter your Application ID (user.handyfeeling.com)',
  'Indtast forbindelseskoden fra Handy-appen': 'Enter the connection key from the Handy app',
  'Sessionen er for lang til Handy (maks ca. 512 KB script)': 'The session is too long for the Handy (max about 512 KB of script)',
  'Upload af script til Handy fejlede': 'Uploading the script to Handy failed',

  // ---- beat scripts
  "Lav scripts til alle PMV'er ({n})": 'Make scripts for all PMVs ({n})',
  'Stop': 'Stop',
  'Laver script {a}/{b}: {name}': 'Making script {a}/{b}: {name}',
  '{n} scripts lavet': '{n} scripts made',
  '{n} fejlede': '{n} failed',
  'Gemmes i mappen "Genererede scripts" i app-mappen, ikke ved videoerne. Tager ca. 1 sek per minut video.':
    'Saved in the "Genererede scripts" folder in the app folder, not next to the videos. Takes about 1 s per minute of video.',
  "Alle PMV'er har et script ({n} lavet automatisk)": 'All PMVs have a script ({n} made automatically)',
  'Lav auto-scripts forfra ({n})': 'Remake auto scripts ({n})',
  'Laver alle auto-scripts igen med den nyeste version. Originaler bliver ikke rørt':
    'Makes all auto scripts again with the newest version. Originals are not touched',
  'Lav alle auto-scripts igen med den nyeste version? Det tager lidt tid. Originaler bliver ikke rørt.':
    'Make all auto scripts again with the newest version? It takes a while. Originals are not touched.',
  'Lav vib': 'Make vib',
  'Alle skuespillere': 'All actors',
  'Skuespiller': 'Actor',
  'Rediger metadata': 'Edit metadata',
  'Metadata er rettet i appen': 'Metadata edited in the app',
  'Titel': 'Title',
  'Skuespillere': 'Actors',
  '(adskil med komma)': '(separate with commas)',
  'Genrer': 'Genres',
  'Studie': 'Studio',
  'År': 'Year',
  'Gemmes i appens database. .nfo-filerne bliver ikke ændret.': 'Saved in the app database. The .nfo files are not changed.',
  'Nulstil til .nfo': 'Reset to .nfo',
  'Brug det der står i .nfo-filen igen': 'Use what the .nfo file says again',
  'Annullér': 'Cancel',
  'Lav vib-scripts til alle andre videoer ({n})': 'Make vib scripts for all other videos ({n})',
  'Lav vib-scripts ud fra stroke-scriptet til alle videoer uden vib (ikke PMV)? Det går hurtigt. Originaler bliver ikke rørt.':
    'Make vib scripts from the stroke script for all videos without vib (not PMVs)? It is quick. Originals are not touched.',
  'Lav vib-scripts til vibratorer (fx Lovense Gush/Edge) ud fra stroke-scriptet': 'Make vib scripts for vibrators (eg. Lovense Gush/Edge) from the stroke script',
  'Vib-scripts lavet automatisk ud fra stroke-scriptet': 'Vib scripts made automatically from the stroke script',
  'Lav vib-scripts til vibratorer (fx Lovense Gush/Edge) ud fra musikken': 'Make vib scripts for vibrators (eg. Lovense Gush/Edge) from the music',
  'Vib-scripts lavet automatisk ud fra musikken': 'Vib scripts made automatically from the music',
  'Laver script og vib-scripts. Gemmes i mappen "Genererede scripts" i app-mappen, ikke ved videoerne. Tager ca. 1 sek per minut video.':
    'Makes scripts and vib scripts. Saved in the "Genererede scripts" folder in the app folder, not next to the videos. Takes about 1 s per minute of video.',
  'Åbn mappen med de lavede scripts': 'Open the folder with the made scripts',
  'Lav script': 'Make script',
  'Laver script…': 'Making script…',
  'Bruger auto-scriptet. Klik for at bruge originalen': 'Using the auto script. Click to use the original',
  'Bruger originalen. Klik for at bruge auto-scriptet': 'Using the original. Click to use the auto script',
  'original': 'original',
  'Nyt script': 'New script',
  'Lav et nyt script ud fra musikkens beat. Originalen bliver ikke rørt, og du kan skifte tilbage':
    "Make a new script from the music's beat. The original is not touched, and you can switch back",
  'Lav et script ud fra musikkens beat (tager ca. 10–60 sek)': "Make a script from the music's beat (takes about 10–60 s)",
  'Scriptet er lavet automatisk ud fra musikken': 'The script was made automatically from the music',

  // ---- beat sync
  '{n} slag/min': '{n} strokes/min',

  // ---- voice lines from Home Assistant
  'Signaler': 'Cues',
  'Lyde': 'Sounds',
  'Stemme (Home Assistant)': 'Voice (Home Assistant)',
  'Mappen hvor Home Assistant gemmer TTS-filer': 'The folder where Home Assistant keeps TTS files',
  'Hent stemmer': 'Load voices',
  'Henter…': 'Loading…',
  '{a} af {b} tekster fundet': '{a} of {b} lines found',
  'Mangler': 'Missing',
  'Lydstyrke': 'Volume',

  // ---- surprises, sound cues
  'Overrask mig: tilfældigt forløb, hastighed og kategori': 'Surprise me: random pattern, speed and category',
  'Af og til et uventet sving: et kort udbrud, en pludselig pause eller et ekstra edge':
    'Now and then an unexpected swerve: a short burst, a sudden pause or an extra edge',
  'Overraskelser ⚡': 'Surprises ⚡',
  'Lyd-signaler ved temposkift, pauser og finale': 'Sound cues at speed changes, pauses and the finale',
  'Lyd-signaler': 'Sound cues',
  'Hør et lyd-signal': 'Hear a sound cue',

  // ---- tidier layout
  'Flere indstillinger': 'More settings',
  'Gem-mappe': 'Save folder',
  'Justering': 'Adjustments',
  'forsinkelse, slag-område': 'delay, stroke range',
  'Vibratorer': 'Vibrators',
  "Firmware 4: Application ID får du gratis på user.handyfeeling.com, forbindelseskoden står i Handy-appen. Scriptet uploades til Handys server og afspilles af Handy'en selv.":
    "Firmware 4: get a free Application ID at user.handyfeeling.com; the connection key is in the Handy app. The script is uploaded to Handy's server and played by the Handy itself.",

  // ---- live steering, learning
  'Roligere kommende klip (↓)': 'Calmer upcoming clips (↓)',
  'Hurtigere kommende klip (↑)': 'Faster upcoming clips (↑)',
  'Afslut nu med en kort finale': 'Finish now with a short finale',
  'Vælger nye klip…': 'Picking new clips…',
  'Mest kunne lide (lært)': 'Liked most (learned)',
  'Glem det lærte': 'Forget what was learned',
  'Glem hvad appen har lært om, hvad du kan lide': 'Forget what the app has learned about what you like',
  'Glem alt hvad appen har lært om, hvad du kan lide?': 'Forget everything the app has learned about what you like?',
  'Lært: du ser den ofte færdig': 'Learned: you often watch it to the end',

  // ---- warm-up
  'Opvarmning (kun video)': 'Warm-up (video only)',
  'Kun video – Handy og vibratorer står stille, før sessionen starter': 'Video only – the Handy and vibrators stay still before the session starts',
  'Opvarmning – Handy står stille · {time} tilbage': 'Warm-up – Handy is still · {time} left',
  'Opvarmning': 'Warm-up',

  // ---- audio levelling
  'Udjævn lydstyrke mellem videoer': 'Even out volume between videos',
  'Udjævn lydstyrke mellem videoer (denne video {db} dB)': 'Even out volume between videos (this video {db} dB)',
  'Måler lydniveau {a}/{b}…': 'Measuring volume {a}/{b}…',

  // ---- build similar
  '🔁 Byg lignende': '🔁 Build similar',
  'Byg en ny session med samme indstillinger, men andre klip': 'Build a new session with the same settings but other clips',
  'Bygger lignende session…': 'Building similar session…',

  // ---- resume, script check
  'Fortsæt {name} fra {time} af {total}?': 'Continue {name} from {time} of {total}?',
  '▶ Fortsæt': '▶ Continue',
  'Nej tak': 'No thanks',
  'Med problemer først': 'With problems first',
  'Script-tjek': 'Script check',
  'Sessioner undgår de dårlige stykker.': 'Sessions avoid the bad parts.',
  'Scriptet slutter {time} før videoen': 'The script ends {time} before the video',
  'Scriptet er {time} længere end videoen': 'The script is {time} longer than the video',
  'Pause på {time} ved {at}': 'Pause of {time} at {at}',
  'Ekstremt hurtige stykker (op til {max} u/s)': 'Extremely fast parts (up to {max} u/s)',
};

const LANG = (() => {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'da' || saved === 'en') return saved;
  } catch { /* ignore */ }
  return (navigator.language || '').toLowerCase().startsWith('da') ? 'da' : 'en';
})();
document.documentElement.lang = LANG;

/** Translate a Danish text; {name} placeholders are filled from `vars`. */
function t(text, vars) {
  let out = LANG === 'en' ? (EN[text] ?? text) : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return out;
}

function setLanguage(lang) {
  try { localStorage.setItem('lang', lang); } catch { /* ignore */ }
  location.reload();
}

/** Translate the static page once (dynamic parts are rendered with t()). */
function translatePage(root = document.body) {
  if (LANG === 'da') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue;
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text && EN[text]) node.nodeValue = raw.replace(raw.trim(), EN[text]);
  }
  root.querySelectorAll('[title], [placeholder], [aria-label]').forEach((el) => {
    ['title', 'placeholder', 'aria-label'].forEach((attr) => {
      const value = el.getAttribute(attr);
      if (value && EN[value]) el.setAttribute(attr, EN[value]);
    });
  });
}
