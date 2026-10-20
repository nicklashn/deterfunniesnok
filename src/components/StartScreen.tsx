import { useRef, useState } from 'react';
import { decodeBytes } from '../lib/csv';
import { SOURCE_URL } from '../config';

interface Props {
  error: string | null;
  onFile: (name: string, text: string) => void;
  onSample: () => void;
}

const STEPS = [
  {
    n: '1',
    title: 'Eksportér ordrerne',
    text: 'Hent en CSV fra jeres webshopsystem med én række pr. ordrelinje. Kolonnerne genkendes automatisk og kan rettes bagefter.',
  },
  {
    n: '2',
    title: 'Gør det til jeres lager',
    text: 'Vælg dag, weekend eller uge. Tilføj jeres navn og logo, åbningstid og medarbejdere, hvis I vil. Lageret skalerer med antallet af varer og ordrer.',
  },
  {
    n: '3',
    title: 'Afspil på storskærmen',
    text: 'Gå ind gennem porten og følg perioden på 30–60 sekunder, med finale, podie og omsætning, hvis I vælger det. Gem det hele som video og del det i Slack eller Teams.',
  },
];

export function StartScreen({ error, onFile, onSample }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);

  // On a phone: hand the link on to a computer (share sheet, or copy as fallback)
  const sendLink = async () => {
    const url = window.location.origin;
    try {
      if (navigator.share) return await navigator.share({ title: 'Lagerforløb', url });
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* cancelled */
    }
  };

  const read = async (file: File | undefined) => {
    if (!file) return;
    onFile(file.name, decodeBytes(await file.arrayBuffer()));
  };

  return (
    <div className="landing">
      <section className="hero2">
        <div className="hero2-text">
          <p className="eyebrow">Til webshops · Gratis · Kører i browseren</p>
          <h1>Se jeres salg blive plukket, pakket og sendt</h1>
          <p className="lede">
            Lagerforløb afspiller en periodes ordrer som et levende 3D-lager. Det passer til fredagsbaren, til
            storskærmen efter Black Friday, eller når I bare vil se, hvad der skete.
          </p>
          <div className="hero2-cta">
            <button className="primary big" onClick={onSample}>Se eksemplet</button>
            <button className="ghost big" onClick={() => input.current?.click()}>Upload ordrefil</button>
          </div>
          <div className="mobile-note">
            <p>
              Lagerforløb er lavet til computer og storskærm. Åbn siden på en computer for at prøve eksemplet eller
              jeres egne tal.
            </p>
            <button className="primary big" onClick={sendLink}>{copied ? 'Link kopieret' : 'Send linket videre'}</button>
          </div>
          <ul className="trust">
            <li>Data forlader aldrig din computer</li>
            <li>Ingen konto</li>
            <li>Ingen cookies</li>
          </ul>
        </div>
        <button className="hero2-visual" onClick={onSample} aria-label="Se eksemplet">
          <img src="/preview.jpg" alt="3D-lager med reoler, medarbejdere, pakkeborde og varevogn" width={1280} height={760} />
          <span className="play-badge" aria-hidden>▶</span>
        </button>
      </section>

      <section className="steps">
        {STEPS.map((s) => (
          <article key={s.n} className="step-card">
            <span className="step-n">{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </article>
        ))}
      </section>

      <section className="get-started">
        <div
          className={`dropzone ${dragging ? 'drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            read(e.dataTransfer.files[0]);
          }}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        >
          <strong>Træk jeres CSV herind</strong>
          <small>eller klik for at vælge en fil. Komma, semikolon og tab genkendes automatisk.</small>
          <ul className="req">
            <li>Ordretidspunkt</li>
            <li>Ordre-ID</li>
            <li>Produktnavn</li>
            <li>Antal</li>
            <li className="opt">Beløb (valgfri)</li>
            <li className="opt">Billede-URL (valgfri)</li>
          </ul>
          <input
            ref={input}
            type="file"
            accept=".csv,.txt,text/csv"
            hidden
            onChange={(e) => {
              read(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <button className="sample-card" onClick={onSample}>
          <strong>Ingen fil ved hånden?</strong>
          <small>Prøv en fiktiv boligwebshop i Black Friday-ugen 24.–30. nov. 2025 med ca. 1.600 ordrer og 12 varer.</small>
          <span className="cta">Åbn eksemplet →</span>
        </button>
      </section>
      {error && <p className="error">{error}</p>}

      <section className="privacy" id="privatliv">
        <div>
          <h2>Jeres data bliver hos jer</h2>
          <p className="muted">
            Filen læses af din browser og bliver der. Der er ingen server, der modtager den, og ingen database.
          </p>
        </div>
        <ul>
          <li><b>Kun i browseren.</b> Ordrer, navne og logo behandles på din egen computer og sendes ingen steder hen.</li>
          <li><b>Intet gemmes.</b> Når du lukker fanen eller genindlæser siden, er det hele væk.</li>
          <li><b>Ingen cookies eller tracking.</b> Der er ingen analyseværktøjer, ingen annoncer og ingen login.</li>
          <li>
            <b>Spærret ude fra andre servere.</b> Siden har en sikkerhedspolitik, der forbyder browseren at sende data
            fra den til andre servere. Den eneste undtagelse er produktbilleder fra jeres egen webshop, hvis I vælger en
            billedkolonne.
          </li>
          <li><b>Kundedata ignoreres.</b> Kolonner med kundenavne, e-mail og adresser bliver ikke læst.</li>
          {SOURCE_URL && (
            <li>
              <b>Åben kildekode.</b> Se selv efter, eller kør den på jeres egen computer:{' '}
              <a href={SOURCE_URL} target="_blank" rel="noreferrer">hent den gratis på GitHub</a>.
            </li>
          )}
        </ul>
      </section>

      <footer className="foot">
        <span>Lagerforløb</span>
        <span>
          Bevægelserne på lageret er illustrative; tallene kommer direkte fra jeres fil. Siden hostes hos Vercel, som
          ligesom alle webhoteller fører standardlogs over besøg (fx IP-adresse). Lagerforløb bruger dem ikke.
        </span>
        {SOURCE_URL && <a href={SOURCE_URL} target="_blank" rel="noreferrer">GitHub</a>}
      </footer>
    </div>
  );
}
