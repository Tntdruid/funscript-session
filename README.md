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
   Valget er også "naturligt": klip starter og slutter ved et vendepunkt i slaget eller en pause
   (højst ±2,5 sek flyttet), næste klip starter helst i samme position som det forrige sluttede,
   slaglængden ligner det forrige klip, en video i samme kategori eller med fælles genre/skuespiller
   foretrækkes som opfølger, og intro/rulletekster (første og sidste 4%) undgås.
   **Takt-sync:** PMV/Cock Hero-videoer (kendt på mappe, genre eller navn) klippes kun på
   bundslaget – i beat-synkrone scripts er det musikkens beat – og efter et PMV-klip foretrækkes et
   klip med samme tempo (slag/min, eller halv/dobbelt takt). Tempoet vises i klip-info.

**Auto-scripts til PMV'er:** PMV'er uden script får knappen "🎵 Lav script". Appen finder musikkens
beat (librosa, i 30-sekunders stykker, så tempo-skift i kompilationer følges) og laver ét slag per
beat – bunden på beatet, slaglængde efter musikkens styrke, stille passager står stille. Scriptet
gemmes i mappen `Genererede scripts` i app-mappen (aldrig ved siden af videoen) med samme
mappestruktur og navn som videoen – `X:\PMV.mp4` → `Genererede scripts\X\PMV.funscript` – så de
kan kopieres over til videoen hvis man vil bruge dem i andre players. De markeres "auto". Under
Bibliotek laver "🎵 Lav scripts til alle PMV'er (N)" scripts til dem alle i baggrunden (med
fremskridt og Stop), og 📂 åbner mappen. Testet mod rigtige PMV-scripts: 71–99 % af de automatiske
slag lander på et rigtigt slag. Kræver `pip install librosa`; uden den vises knapperne ikke.
PMV'er der allerede har et script, får knappen "🎵 Nyt script": appen laver et auto-script ved siden
af (originalen bliver aldrig rørt) og bruger det. Knappen "auto ⇄ / original ⇄" skifter mellem de to.
"↻ Lav auto-scripts forfra" laver alle auto-scripts igen med den nyeste version af beat-genkendelsen.
Manglende beats midt i musikken bliver fyldt ud, så der ikke kommer huller i scriptet.

**Auto vib-scripts:** Samtidig laves `.vib` og `.vib2` til vibratorer (fx Lovense Gush 2 og Edge):
`.vib` pulserer på beatet og bliver stærkere når musikken er høj, `.vib2` (motor 2) pulserer på
mellemslaget med bassens styrke, så de to motorer skiftes. De bruges kun når videoen ikke har sine egne vib-scripts. PMV'er der har et script men ingen
vib, får knappen "📳 Lav vib", og "Lav scripts til alle PMV'er" laver dem også.
Andre videoer (ikke PMV) kan få vib-scripts ud fra deres stroke-script: én puls per slag, stærkere
jo hurtigere slaget er, og hurtige slag samles til pulser på mindst 250 ms. `.vib2` pulserer midt i
hvert slag med det samlede tempos styrke. Brug "📳 Lav vib" på en video eller "📳 Lav vib-scripts til alle andre videoer" (tager et par
minutter for flere hundrede videoer, kræver ikke librosa).
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

**Skraldespande springes over:** Scanningen går ikke ind i papirkurve og systemmapper (`#recycle`,
`@eaDir`, `#snapshot` på Synology, `$RECYCLE.BIN`, `System Volume Information`, `.Trash` og skjulte mapper).

**Kategorier:** Mapperne i biblioteket (fx `X:\Handy\PoV`) bliver kategorier, som kan vælges
under "Ny session". Mapper med kun én video havner under "Løse filer". Derudover samler "PMV"
alle PMV/Cock Hero/beat-videoer, uanset hvilken mappe de ligger i.

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

**Overrask mig:** 🎲 ved "Byg session" bygger en session med tilfældigt forløb, hastighed og
(nogle gange) kategori, med den valgte længde. "Overraskelser ⚡" (under Flere indstillinger) giver
2–4 uventede sving per 20 min: ⚡ et kort udbrud (+40%), ⏸ en pludselig pause eller 🔥 et ekstra
edge (op og så stop). De vises på klip-kortene.

**Lyd-signaler:** 🔔 ved afspilleren. Korte, diskrete lyde (laves i browseren, intet at hente):
klokke ved start/slut på opvarmning, sus op/ned ved temposkift, dyb tone ved pause, "zap" ved
udbrud, stigende tone ved edge, gong ved finale, to tik ved sidste minut og et blip ved ▲▼.
Højst hvert 4. sek (vigtige 1,5 sek). Lydstyrke og 🔊 prøve under Enheder → Justering.

**Stemme fra Home Assistant:** Under Justering → Signaler kan "Stemme (Home Assistant)" vælges.
Lav teksterne i `stemme-tekster.txt` med HA's TTS (fx Christel); HA gemmer dem som mp3 med teksten
som titel. Angiv HA's tts-mappe (fx `\<ha>\config	ts`) og tryk "Hent stemmer": appen læser
titlerne, kopierer de matchende filer til sin cache (HA-mappen bliver kun læst) og bruger dem
fremover. Tekster uden optagelse falder tilbage til lyd-signalet. Kun på dansk.

**Live-styring:** Under afspilning vælger ▲ (eller pil op) hurtigere og ▼ (pil ned) roligere
kommende klip (±15% per tryk), og ⏹ erstatter resten med ca. 2 min finale. Klippet, der spiller
nu, fortsætter uforstyrret; Handy'en får det nye script i baggrunden. Ændringen gemmes i sessionen.

**Lærer hvad du kan lide:** Klip du ser færdige tæller positivt; klip du springer over (⏭ før
halvvejs), bytter eller fjerner tæller negativt. Sessioner foretrækker derefter de videoer du kan
lide (♥ i gitteret, sortér "Mest kunne lide") og undgår de stykker du sprang over. Det vejer mindre
end ★, nyere handlinger tæller mest, og "Glem det lærte" i gitteret nulstiller.

**Opvarmning:** "Opvarmning (kun video)" (0–10 min) lægger rolige klip før sessionen, hvor
Handy'en holder stille og vibratorer er slukket; derefter glider den ind i sessionen. Nedtællingen
vises ved afspilleren, og opvarmningen er markeret blå på tidslinjen. Den bevares ved redigering
og "Byg lignende".

**Byg lignende:** "🔁 Byg lignende" (ved sessionens navn eller i listen) laver en ny session med
præcis samme indstillinger og videoudvalg, men nye klip – den forrige sessions stykker undgås.

**Rediger klip:** Hold musen over et klip: 🔄 bytter det med et andet stykke video i samme hastighed
og længde (helst en video, der ikke allerede er med – tryk igen for et nyt forslag), ✕ fjerner det.
Træk et klip for at flytte det. Slag- og vib-scriptet bygges om med sessionens indstillinger, og
de gemte filer i `sessions\` opdateres.

**Ens lydstyrke:** Serveren måler lydniveauet for hver video i baggrunden (ffmpeg, 4 prøver á 20 sek;
ca. 5 min for 330 videoer første gang, derefter kun nye/ændrede). Under afspilning skrues hver video
op/ned mod bibliotekets median (højst +18/−15 dB), med en blid kompressor og en limiter mod
forvrængning. Knappen ≋ ved lydstyrken slår det til/fra; tooltip viser korrektionen for videoen.

**Fortsæt hvor du slap:** Positionen gemmes i databasen hvert 5. sek under afspilning og ved pause.
Næste gang appen åbnes, tilbydes "Fortsæt … fra 7:32". Færdigspillede sessioner tilbydes ikke.

**Script-tjek:** Scan finder scripts, der slutter mindst 1 min før videoen, er længere end videoen,
har pauser på 1½ min eller mere, eller har ekstremt hurtige stykker (over 800 u/s). De markeres med ⚠
(hold musen over for detaljer), kan sorteres øverst i gitteret, og sessioner undgår stykker med
ekstrem hastighed eller meget stilstand.

**Forhåndsvisning:** Hold musen over et kort i gitteret – videoen spiller lydløst og springer
gennem fire steder; en hvid markør på hastighedskurven viser hvor.

**⭐ Yndlingssteder:** Tryk ⭐ eller B (eller ⭐ på mobilen) mens noget spiller, du kan lide. Sessioner
vælger derefter oftere netop den del af videoen (og videoer med ⭐ lidt oftere). Kan fortrydes.

**∞ Uendelig:** Med ∞ slået til bygges en lignende session med nye klip 1½ minut før slutningen, og den
tager over, når den gamle slutter, så det bare fortsætter, indtil du stopper.

**🎯 Edge-spil:** 🎯 ved siden af "Byg session" bygger en opbyggende session. Tryk "😮 Tæt på" (E, eller
på mobilen), når du er tæt på: enhederne holder pause (20 s, lidt længere hver gang), de næste klip
vælges roligere, og så bygger den op igen. Til sidst ser du, hvor mange gange og hvor længe du holdt.

**Forhåndsvisning:** Hold musen over et klip i klip-stribe for at se netop det klip (uden lyd).

**📊 Statistik og backup:** Spilletid (i alt og de sidste 7 dage), sessioner, mest brugte videoer og
kategorier, hvor mange klip du ser færdig, ⭐-steder og edge-spil. "💾 Gem backup" gemmer alt, du har
lavet og valgt (også opsætninger) i én fil; "📂 Gendan backup" lægger den sammen med det, der er her,
uden at slette noget. Handy-nøgler kommer ikke med i backuppen.

**Gemte opsætninger:** "＋ Gem opsætning" over "Byg session" gemmer dine valg (længde, forløb,
hastighed, kategorier, opvarmning, overraskelser osv.) som en knap; ét tryk sætter dem og bygger.

**Fortryd:** 👎, sletning af en session og "Glem det lærte" viser en besked i bunden med "Fortryd" i 6
sekunder i stedet for en popup. Sletninger sker først, når beskeden forsvinder.

**Forbind automatisk:** Handy og Intiface forbinder selv, når appen åbner, hvis de var forbundet sidst.
"Afbryd" slår det fra igen.

**Hjælp:** ? øverst (eller tasten ?) viser alle tastaturgenveje og hvad knapperne gør.

**Afspil på tv (Samsung m.fl.):** Tryk Win+K på PC'en og vælg tv'et (Skærmspejling), og brug ⛶
fuldskærm. Slå "📺 Spejler til tv" til under Justering: billedet kommer lidt senere frem på tv'et, så
Handy og vibratorer venter tilsvarende (start −250 ms, kan stilles fra −1500 til +500 ms). Tv og PC
husker hver sin forsinkelse.
"🎯 Kalibrér forsinkelse" viser en cirkel, der blinker og klikker hvert sekund, mens Handy rammer bunden
på blinket (vibratorer giver et puls). Træk i skyderen (eller ← →) til de passer, og tryk Gem.

**Fjernbetjening fra mobilen:** Slå "📱 Styr fra mobilen" til under Enheder, og åbn linket på mobilen
(samme wifi). Her er afspil/pause, forrige/næste, ✋ hold stille (enhederne står stille, videoen kører
videre, også H på tastaturet), ▼▲⏹, tempo og lydstyrke. Fjernbetjeningen kører på port 8001 og kan kun
styre afspilningen, og kun med nøglen i linket; resten af appen kan stadig kun nås fra PC'en selv.
"Nyt link" laver en ny nøgle. Første gang spørger Windows Firewall: tillad Python på private netværk.

**Rediger metadata:** ✎ på et billede i det store overblik åbner en editor til titel, skuespillere,
genrer, studie og år. Rettelserne gemmes i appens database og overlever en ny scanning; .nfo-filerne
bliver aldrig ændret. "Nulstil til .nfo" fjerner rettelserne igen.

**Stort overblik:** "⊞ Vis store billeder" åbner et gitter med store billeder, titler, skuespillere og
år fra Jellyfin-`.nfo`-filerne. Søg i titel/skuespiller/genre/studie, filtrér på genre, skuespiller og kategori,
sortér (navn, favoritter, hastighed, længde, mindst afspillet), og klik på et billede for at vælge
det til/fra sessioner. ★/👎 kan sættes direkte på kortet. Esc lukker.

**Thumbnails:** Vises i biblioteket. De laves én gang med ffmpeg fra videoens egen poster
(`<navn>-poster.jpg`, `folder.jpg` osv.) eller et billede fra videoen, og gemmes i den lokale cache
(`...\FunscriptSession\thumbs`). Biblioteket røres ikke.

**Tempo:** Skyderen ved afspilleren (50–150%, eller `[` og `]`) ændrer tempoet for både video og Handy.

**Maks hastighed:** Undgår stykker over grænsen og gør for hurtige slag kortere, så intet slag i
sessionen overstiger den. Bemærk at tempo over 100% gør slagene hurtigere igen.

**Forløb:** Konstant, Opbygning, Bølger, Edging (tre opbygninger med pauser) og Finale (roligt,
så et hurtigt sidste stykke), samt Hele turen (Opbygning → Bølger → Edging → Finale i én session:
25% / 25% / 30% / 20%). Kortere tid per video giver blødere kurver.

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

Miljøvariabler: `FUNSCRIPT_DB` (sti til database), `FUNSCRIPT_PORT` (standard 8000).
