# Lagerforløb – noter til Claude

Statisk Vite + React + TypeScript-app, der genafspiller en webshops salg som et 3D-lager (React Three Fiber). Se README.md for funktioner og CSV-format.

```bash
npm run dev     # udvikling
npm test        # vitest (beregninger, pakning, kamera)
npm run build   # typecheck + statisk build til dist/
```

Kør `npm test` og `npm run build` efter hver ændring.

## Faste regler (bryd dem ikke uden at spørge)
- **Alt sker i browseren.** Ingen backend, database, login, analytics, LLM-kald, eksterne fonte eller CDN'er. CSP'en i `vercel.json` (`connect-src 'self'`) skal blive ved med at virke; tilføj ikke domæner til den.
- **Gem ikke uploadede data** (ingen localStorage/IndexedDB med ordrer, navne eller logo).
- **Læs ikke kundekolonner.** Kolonner, der ligner kundedata, filtreres fra i `src/lib/mapping.ts`.
- **Tal er præcise, bevægelser er illustrative.** Alt, der vises som et tal (reoletiketter, top 5, tællere, afhentning, pakket/venter, finale), skal komme fra de forudberegnede data i `src/lib/`. Simulationen i `warehouse/sim.ts` må aldrig påvirke et tal på skærmen.
- **Ingen opdigtede højdepunkter.** Begivenheder (første ordre, førerskift, travleste time) beregnes i `race.ts` ud fra data.
- Unikke ordrer tælles på ordre-ID.

## Hvor ligger hvad
- `src/lib/`: ren logik uden React: CSV-parsing, kolonnetilknytning, `race.ts` (stillinger og begivenheder), `packing.ts` (hvornår hver ordre pakkes), `hours.ts` (åbningstid), `staff.ts`, eksempeldata i `sample.ts`. Nye beregninger hører til her, med tests.
- `src/components/`: skærmene (Start, Mapping, Setup, Player, Summary = finalen).
- `src/components/warehouse/`:
  - `layout.ts`: plantegning skaleret efter data
  - `sim.ts`: illustrativ simulation af medarbejdere og pakker
  - `models.tsx`: 3D-former, bygget af simple former uden eksterne modeller
  - `intro.tsx`: introen
  - `camera.ts`: kameraets indramning
  - `signs.ts`: skilte tegnet på canvas
  - `WarehouseView.tsx`: binder det hele sammen og laver DOM-etiketter
- `src/config.ts`: `SOURCE_URL` (link til kildekoden på forsiden).
- `src/lib/record.ts`: video-eksport via fanedeling og MediaRecorder; filen gives kun som download. Player skifter til projektor-layoutet (`.player.rec`) og genstarter fra intro, mens der optages.
- `index.html` + `vite.config.ts`: delingskort (`og.jpg`, absolut URL via `SITE_URL`/Vercels domæne).

## Typiske tilpasninger
- **Virksomhedens farver:** CSS-variabler øverst i `src/styles.css` og `PALETTE` i `warehouse/models.tsx`.
- **Faste firmanavn og logo:** standardværdier i `DEFAULT_SETTINGS` (`SetupScreen.tsx`). Et logo kan lægges i `public/` (samme origin, så CSP'en tillader det).
- **Egen eksportfil:** tilføj kolonnenavne til gættelisterne i `src/lib/mapping.ts`.
- **Åbningstid, pakketempo og afhentning:** `DEFAULT_HOURS` (`hours.ts`), `packingRate` (`packing.ts`) og `pickupSchedule` (`WarehouseView.tsx`).
- **Flere eller andre zoner i lageret:** `layout.ts` (kameraet tilpasser sig selv via `fitPose`).

## Stil
- UI-tekst er på dansk; kode og kommentarer på engelsk.
- Hold det enkelt: ingen nye afhængigheder uden god grund. Three.js ligger i sin egen chunk (lazy-loadet).
- Appen er lavet til store skærme og projektor (fuld skærm med F), ikke mobil.
- Kontrollér visuelle ændringer i browseren med eksempeldata: `http://localhost:5173/?demo&firma=Navn` åbner direkte i afspilleren.
