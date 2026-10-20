# Lagerforløb

Genafspiller en webshops salg for en valgt periode som et illustreret 3D-lagerforløb. Vite + React + TypeScript, ingen backend – CSV'en læses og behandles kun i browseren og gemmes ingen steder.

```bash
npm install
npm run dev      # udvikling
npm test         # beregningstests (vitest)
npm run build    # typecheck + statisk build til dist/
```

**Vercel:** importér mappen/repoet – Vite registreres automatisk (build `npm run build`, output `dist`). Ingen env-variabler er påkrævet. Delingskortet (og:image til LinkedIn/Slack) bruger Vercels produktionsdomæne automatisk; andre steder sættes `SITE_URL=https://…` ved build. `vercel.json` sætter en Content-Security-Policy (`connect-src 'self'`, kun egne scripts), så browseren ikke kan sende data til andre servere; `npm run preview` bruger samme headers. Billeder må hentes fra https (produktbilleder fra webshoppen).

Linket til kildekoden på forsiden står i `src/config.ts` (`SOURCE_URL`); ret det, hvis du laver din egen kopi. Licens: MIT (se `LICENSE`).

Genveje: `?demo` åbner eksemplet direkte (`&firma=Navn`, `&omsaetning`). I afspilleren: mellemrum = pause/spring intro over, R = genstart, F = fuld skærm.

**Gem som video:** knappen optager hele forløbet fra intro til finale i projektor-layoutet og gemmer en MP4 (WebM i browsere uden MP4-optagelse) til deling i Slack, Teams eller på LinkedIn. Det bruger browserens skærmdeling af fanen (Screen Capture API + MediaRecorder), så intet uploades; optagelsen stopper selv efter finalen (Esc stopper før). Bedst i Chrome/Edge, som foreslår den aktuelle fane. Bliv på fanen, mens den optager. Videoen får fanens opløsning, så brug et maksimeret vindue på en 1080p-skærm for fuld HD.

**Mobil:** forsiden viser en kort forklaring og en knap til at sende linket videre; selve appen er lavet til computer og storskærm.

## CSV-format
Én række pr. ordrelinje. Påkrævet: ordretidspunkt, ordre-ID, produktnavn, antal. Valgfrit: beløb (linjetotal eller stykpris) og produktbillede-URL. Kolonnenavne gættes (dansk/engelsk, fx Shopify-eksport) og kan rettes manuelt. Kolonner der ligner kundedata vises ikke og læses ikke.

Tidspunkter uden tidszone tolkes i browserens lokale tid.

## Struktur
- `src/lib/` – ren logik: CSV-parser, tal/dato-parsing, kolonnetilknytning, `race.ts` (stillinger, begivenheder, travleste time), eksempeldata. Ingen animationskode.
- `src/components/` – UI; afspilleren slår kun op i de forudberegnede data på afspilningstidspunktet.

## Regler i beregningen
- Ordrer tælles som unikke ordre-ID'er (placeret ved første linjes tidspunkt).
- Placering: flest enheder; ved lighed beholder den, der nåede antallet først, pladsen. Samme regel bruges til førerskift og podium.
- Travleste time: lokal klokketime med flest unikke ordrer (tidligste ved lighed).

## Lagerscenen
Bygget med React Three Fiber af simple former (ingen modeller eller eksterne filer). Three.js ligger i sin egen chunk.

- **Intro:** kameraet starter foran facaden med virksomhedens navn/logo, porten rulles op, loftslamperne tænder række for række, og kameraet flyver gennem midtergangen op til overblikket i én bevægelse (`intro.tsx`). Overblikskameraet tilpasses scenens størrelse og skærmens format (`camera.ts`). Skilte tegnes på et 2D-canvas (`signs.ts`) – ingen fonte eller filer hentes.
- **Skalering:** én reol pr. produkt (op til 24; resten samles på "Øvrige varer"), fordelt på flere gange. Pakkeborde, salgsborde og antal medarbejdere (uden navne) skaleres efter periodens travleste time.
- **Åbningstid** (standard 7–22, kan sættes til døgnåbent): i åbningstiden er alle på gulvet; ledige rydder op ved reolerne. Ved lukketid toner figurerne ud, lyset dæmpes (stadig læsbart på projektor, med varme arbejdslamper), og ordrer fra natten pakkes næste morgen. Afhentning sker kun i åbningstiden (daglig afhentning ved lukketid). Tallene påvirkes ikke.
- **Etiketter:** reolerne viser kun antallet (navnet står i "Mest solgte"-listen øverst til venstre, top 5, hvor rækkerne glider ved overhalinger). Etiketter skubbes fra hinanden, så de ikke overlapper.
- **Fuld skærm (F):** ur og nøgletal lægges ind over scenen i stor skrift til projektor.
- **Præcise tal:** reoletiketter, søjlehøjder, tællere og afhentningsetiketten aflæses fra de samme beregninger.
- **Pakning** (`src/lib/packing.ts`): hver ordre pakkes én gang, i ankomstrækkefølge, i et fast tempo lidt over periodens travleste time og kun i åbningstiden. Nattens ordrer bliver derfor en kø, der pakkes ned om morgenen. Tidspunktet er modelleret; antallet er præcist. Medarbejderne plukker varerne, når deres ordre pakkes.
- **Afhentning:** varevognen henter på faste klokkeslæt (hver 1/2/3/4/6/8/12 time eller dagligt, valgt så turen kan ses ved 1×) og tager præcis de ordrer, der er pakket siden sidste afhentning. Etiketten viser "pakket" og "venter på pakning".
- **Pakker:** pallerne ved udleveringen viser altid det pakkede antal siden sidste afhentning, også lige efter et hop på tidslinjen. Én pakke = én ordre, eller N ordrer, når den største last ikke ellers kan stå på pallerne (vises i scenen). Kassene på båndet viser kun flowet.
- **Illustration:** medarbejdernes ruter og plukportioner er illustrative og afspejler ikke rigtige medarbejdere.
- **Medarbejdernavne (valgfrit):** indtast navne eller importér en CSV (kolonnen "Navn"/"Name", ellers første kolonne; øvrige kolonner læses ikke). Højst 500; der er op til 36 på gulvet ad gangen, og holdene skifter jævnt hen over perioden. Navnene vises over lagerfigurerne, men opgaverne fordeles tilfældigt. Der vises ingen statistik pr. person, og navnene gemmes ikke.
- **Finale** i trin (klik/mellemrum går videre): optælling til det præcise tal (omsætning hvis valgt, ellers solgte varer) → travleste time, bedste dag og skift på førstepladsen → podie afsløret som 3., 2. og til sidst 1. med konfetti → samlet oversigt.
- Kode: `src/components/warehouse/` (`layout.ts` plantegning, `sim.ts` illustrativ simulation, `models.tsx` 3D-former, `WarehouseView.tsx` scene og etiketter).
