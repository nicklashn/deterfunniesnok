import { useEffect, useMemo, useState } from 'react';
import { StartScreen } from './components/StartScreen';
import { MappingScreen } from './components/MappingScreen';
import { DEFAULT_SETTINGS, SetupScreen, type RaceSettings } from './components/SetupScreen';
import { Player } from './components/Player';
import { parseCsv, type ParsedCsv } from './lib/csv';
import { autoDetect, buildLines, guessAmountMode, missingRequired, type BuildResult } from './lib/mapping';
import { buildRace, periodPresets } from './lib/race';
import { generateSampleCsv } from './lib/sample';
import type { AmountMode, Mapping } from './lib/types';

type Step = 'start' | 'mapping' | 'setup' | 'play';

interface Source {
  name: string;
  csv: ParsedCsv;
}

/** All data lives in React state only: nothing is persisted, a reload clears it. */
export default function App() {
  const [step, setStep] = useState<Step>('start');
  const [source, setSource] = useState<Source | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [amountMode, setAmountMode] = useState<AmountMode>('line');
  const [built, setBuilt] = useState<BuildResult | null>(null);
  const [settings, setSettings] = useState<RaceSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadText = (name: string, text: string, skipMappingIfComplete: boolean) => {
    const csv = parseCsv(text);
    if (!csv.headers.length || !csv.rows.length) {
      setError('Filen ser tom ud – der skal være en overskriftsrække og mindst én ordrelinje.');
      return;
    }
    const m = autoDetect(csv.headers);
    setError(null);
    setSource({ name, csv });
    setMapping(m);
    const mode = guessAmountMode(csv.headers, m);
    setAmountMode(mode);
    if (skipMappingIfComplete && missingRequired(m).length === 0) {
      setBuilt(buildLines(csv.rows, m, mode));
      setStep('setup');
    } else setStep('mapping');
  };

  // Dev shortcut: ?demo opens straight into playback of the sample data (whole period)
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('demo')) return;
    const csv = parseCsv(generateSampleCsv());
    const m = autoDetect(csv.headers);
    const b = buildLines(csv.rows, m, 'line');
    const all = periodPresets(b.lines)[0];
    setSource({ name: 'Eksempel: Black Friday-uge.csv', csv });
    setMapping(m);
    setBuilt(b);
    const q = new URLSearchParams(window.location.search);
    setSettings({ ...DEFAULT_SETTINGS, start: all.start, end: all.end, durationSec: 60, showRevenue: q.has('omsaetning'), company: q.get('firma') ?? '' });
    setStep('play');
  }, []);

  const race = useMemo(
    () => (built && settings ? buildRace(built.lines, settings.start, settings.end) : null),
    [built, settings],
  );

  const reset = () => {
    setSource(null);
    setMapping(null);
    setBuilt(null);
    setSettings(null);
    setStep('start');
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={reset} title="Til forsiden">
          <span className="brand-mark" aria-hidden />
          Lagerforløb
        </button>
        {source && step !== 'start' && (
          <nav className="crumbs">
            <span className="file-pill" title={source.name}>{source.name}</span>
            <button className={step === 'mapping' ? 'on' : ''} onClick={() => setStep('mapping')}>Kolonner</button>
            <button className={step === 'setup' ? 'on' : ''} disabled={!built} onClick={() => setStep('setup')}>Periode</button>
          </nav>
        )}
        <span className="local-badge" title="Filen læses i browseren og sendes ingen steder hen. Intet gemmes.">
          Behandles lokalt
        </span>
      </header>

      <main>
        {step === 'start' && (
          <StartScreen
            error={error}
            onFile={(name, text) => loadText(name, text, false)}
            onSample={() => loadText('Eksempel: Black Friday-uge.csv', generateSampleCsv(), true)}
          />
        )}

        {step === 'mapping' && source && mapping && (
          <MappingScreen
            csv={source.csv}
            mapping={mapping}
            amountMode={amountMode}
            onChange={setMapping}
            onAmountMode={setAmountMode}
            onBack={reset}
            onContinue={() => {
              setBuilt(buildLines(source.csv.rows, mapping, amountMode));
              setStep('setup');
            }}
          />
        )}

        {step === 'setup' && built && (
          <SetupScreen
            built={built}
            initial={settings}
            onStart={(s) => {
              setSettings(s);
              setStep('play');
            }}
          />
        )}

        {step === 'play' && race && settings && (
          <Player
            key={`${settings.start}-${settings.end}`}
            data={race}
            settings={settings}
            onSettings={setSettings}
            onExit={() => setStep('setup')}
          />
        )}
      </main>
    </div>
  );
}
