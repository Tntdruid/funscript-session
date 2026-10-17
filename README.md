# Funscript Session Player

En let funscript-player der bygger sessioner af en bestemt længde (fx 15 min) ud fra
klip fra flere videoer, valgt så scriptets hastighed passer sammen.

## Kør det

```bash
python server.py
```

Åbn http://127.0.0.1:8000 – vælg mappen med dine videoer og tryk **Scan**.

Kræver kun Python 3.9+ (ingen pakker). `ffprobe` bruges til videolængde hvis det er installeret,
ellers bruges længden af scriptet.

## Sådan virker det

1. **Scan** finder videoer og deres script på filnavn (`Video.mp4` → `Video.funscript`).
   Hvert script analyseres i 5-sekunders vinduer: gennemsnitlig hastighed i *u/s*
   (positions-enheder per sekund, 0–100 skala). Resultatet gemmes i `funscript.db` (SQLite),
   så kun nye/ændrede filer analyseres igen.
2. **Byg session** vælger længde, tid per video, mål-hastighed og forløb
   (konstant, opbygning eller bølger). For hvert klip findes det stykke i hver video
   hvis hastighed ligger tættest på målet (og er mest stabilt). Videoer der afviger mere
   end ±30% bruges kun hvis intet andet passer.
3. Klippene lægges efter hinanden og der samles ét funscript for hele sessionen, som gemmes
   i databasen og kan downloades som `.funscript`.
4. Afspilleren skifter sømløst mellem klip (næste klip forudindlæses) og styrer en enhed via
   Intiface Central (Buttplug, `linear` for Handy/OSR, `vibrate` for vibratorer).

Hver session gemmes også automatisk som `.funscript` i mappen `sessions\` (kan ændres under
"Gemte sessioner"). Filen hedder fx `004 - 15 min · Opbygning · 216 u-s.funscript`, og listen
over klip står i scriptets metadata. Sletter man en session i appen, bliver filen liggende.

**Handy direkte (firmware 4, Handy API v3):** Vælg "Handy direkte" under Enhed, indtast dit
Application ID og forbindelseskoden fra Handy-appen og tryk Forbind. Application ID kræver en gratis
udviklerkonto: anmod om invitation på https://user.handyfeeling.com/invite, registrér dig, log ind
og udsted et API-token (Application ID). Sessionens samlede script uploades til Handys egen script-hosting, og Handy'en
afspiller det selv i sync med videoen (HSSP). Ved spoling, klipskift eller buffering resynces den
automatisk. Koden gemmes kun i din browser. Intiface kan stadig vælges til andre enheder.

**Kategorier:** Mapperne i biblioteket (fx `X:\Handy\PoV`) bliver kategorier, som kan vælges
under "Ny session". Mapper med kun én video havner under "Løse filer".

**Overgange:** Mellem klip glider scriptet over 600 ms i stedet for at hoppe, og billedet tones over.
Slås "Glidende overgange mellem klip" fra, er hvert punkt i sessionens script 100% fra dine
originale filer (kun klippenes start/slut-punkter beregnes, og de ligger på den originale kurve).

**Vibratorer (Lovense Edge, Gush 2 m.fl.):** Forbind via Intiface Central under "Enheder" – kan køre
samtidig med Handy direkte. Scan finder `Video.vib.funscript` (motor 1) og `Video.vib2.funscript`
(motor 2, fx Edge). Under "Vibration" vælges: "Automatisk" (standard – vibration kun når en vibrator er forbundet
via Intiface, når sessionen bygges; ellers kun slag), "Ingen vibration (kun Handy/slag)" (ingen
vib-spor eller .vib-filer), "Brug .vib-script – afled af slag, hvor det mangler", eller "Kun videoer med
.vib-script". Sessionen gemmes også som `.vib.funscript`/`.vib2.funscript`.
Kommandoer sendes kun ved ændringer (maks ~10/s), så Bluetooth ikke overbelastes. "Vib-styrke"
skalerer alle vibratorer.

**Temperatur:** Med "Handy direkte" vises motortemperaturen (læses hvert 5. sek under afspilning).
10 °C under grænsen vises en advarsel. Over grænsen (standard 70 °C, kan sættes 50–74 °C) pauser
appen og blokerer ▶, indtil motoren er 8 °C under grænsen. Den starter ikke selv igen. Handy'en har
desuden sin egen indbyggede beskyttelse ved 75 °C.

**Favoritter og frasortering:** ★ på en video gør at den foretrækkes i sessioner, 👎 betyder at den
aldrig bruges. "Kun favoritter" bygger sessioner udelukkende af ★-videoer.

**Klip i sessionen:** Under afspilleren vises alle klip i den åbne session med billede, titel,
hastighed og længde. Det aktive klip er markeret; klik for at springe til et klip. Sessionen
omdøbes med ✎ (eller dobbeltklik på navnet) – også fra listen over gemte sessioner. De gemte
filer i `sessions\` får samme nye navn.

**Byg lignende:** "🔁 Byg lignende" (ved sessionens navn eller i listen) laver en ny session med
præcis samme indstillinger og videoudvalg, men nye klip – den forrige sessions stykker undgås.

**Rediger klip:** Hold musen over et klip: 🔄 bytter det med et andet stykke video i samme hastighed
og længde (helst en video, der ikke allerede er med – tryk igen for et nyt forslag), ✕ fjerner det.
Træk et klip for at flytte det. Slag- og vib-scriptet bygges om med sessionens indstillinger, og
de gemte filer i `sessions\` opdateres.

**Fortsæt hvor du slap:** Positionen gemmes i databasen hvert 5. sek under afspilning og ved pause.
Næste gang appen åbnes, tilbydes "Fortsæt … fra 7:32". Færdigspillede sessioner tilbydes ikke.

**Script-tjek:** Scan finder scripts, der slutter mindst 1 min før videoen, er længere end videoen,
har pauser på 1½ min eller mere, eller har ekstremt hurtige stykker (over 800 u/s). De markeres med ⚠
(hold musen over for detaljer), kan sorteres øverst i gitteret, og sessioner undgår stykker med
ekstrem hastighed eller meget stilstand.

**Forhåndsvisning:** Hold musen over et kort i gitteret – videoen spiller lydløst og springer
gennem fire steder; en hvid markør på hastighedskurven viser hvor.

**Stort overblik:** "⊞ Vis store billeder" åbner et gitter med store billeder, titler, skuespillere og
år fra Jellyfin-`.nfo`-filerne. Søg i titel/skuespiller/genre/studie, filtrér på genre og kategori,
sortér (navn, favoritter, hastighed, længde, mindst afspillet), og klik på et billede for at vælge
det til/fra sessioner. ★/👎 kan sættes direkte på kortet. Esc lukker.

**Thumbnails:** Vises i biblioteket. De laves én gang med ffmpeg fra videoens egen poster
(`<navn>-poster.jpg`, `folder.jpg` osv.) eller et billede fra videoen, og gemmes i den lokale cache
(`...\FunscriptSession\thumbs`). Biblioteket røres ikke.

**Tempo:** Skyderen ved afspilleren (50–150%, eller `[` og `]`) ændrer tempoet for både video og Handy.

**Maks hastighed:** Undgår stykker over grænsen og gør for hurtige slag kortere, så intet slag i
sessionen overstiger den. Bemærk at tempo over 100% gør slagene hurtigere igen.

**Forløb:** Konstant, Opbygning, Bølger, Edging (tre opbygninger med pauser) og Finale (roligt,
så et hurtigt sidste stykke).

Genveje: mellemrum = afspil/pause, ←/→ = 10 sek, N = næste klip, F = fuldskærm, `[`/`]` = tempo.
Klik på videoen = afspil/pause, dobbeltklik = fuldskærm. I fuldskærm vises en kontrollinje,
når musen bevæges.

## Sprog / Language

Appen findes på dansk og engelsk – skift med **DA/EN** øverst til venstre (valget huskes; første
gang bruges browserens sprog). Alle tekster er skrevet på dansk i koden; `web/i18n.js` har den
engelske ordbog, så en ny tekst skal også tilføjes dér. Serverens fejlbeskeder og nye sessionsnavne
følger det valgte sprog.

## Filer

- `server.py` – HTTP-server, API og video-streaming (med Range/seek)
- `funlib.py` – scanning, analyse, database og session-bygger
- `web/` – frontend (vanilla HTML/CSS/JS)
- `legacy/` – den gamle prototype (åbnes på `/legacy/index.html`)

Miljøvariabler: `FUNSCRIPT_DB` (sti til database), `FUNSCRIPT_PORT` (standard 8000).
