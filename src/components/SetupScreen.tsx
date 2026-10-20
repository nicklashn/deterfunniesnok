import { useMemo, useRef, useState } from 'react';
import type { BuildResult } from '../lib/mapping';
import { buildRace, periodPresets } from '../lib/race';
import { fmtInt, fmtKr, fmtRange, fromInputValue, toInputValue } from '../lib/format';
import { decodeBytes } from '../lib/csv';
import { MAX_ON_FLOOR, MAX_STAFF, parseStaffCsv, parseStaffText } from '../lib/staff';
import { DEFAULT_HOURS, type OpenHours } from '../lib/hours';

export interface RaceSettings {
  start: number;
  end: number;
  durationSec: number;
  showRevenue: boolean;
  /** Optional staff names shown over the warehouse figures (illustrative only). */
  staff: string[];
  /** Optional company name and logo (data URL) for the signs in the scene. */
  company: string;
  logo: string | null;
  hours: OpenHours;
}

export const DEFAULT_SETTINGS = { staff: [] as string[], company: '', logo: null, hours: DEFAULT_HOURS };
const HOUR_OPTIONS = Array.from({ length: 25 }, (_, h) => h);
const MAX_LOGO_BYTES = 2_000_000;

interface Props {
  built: BuildResult;
  initial: RaceSettings | null;
  onStart: (s: RaceSettings) => void;
}

const DURATIONS = [30, 45, 60];
const GROUP_LABEL = { all: '', day: 'Dage', weekend: 'Weekender', week: 'Uger' } as const;

export function SetupScreen({ built, initial, onStart }: Props) {
  const presets = useMemo(() => periodPresets(built.lines), [built]);
  const [start, setStart] = useState(initial?.start ?? presets[0].start);
  const [end, setEnd] = useState(initial?.end ?? presets[0].end);
  const [durationSec, setDuration] = useState(initial?.durationSec ?? 60);
  const hasAmount = built.lines.some((l) => l.amount !== null);
  const [showRevenue, setShowRevenue] = useState(initial?.showRevenue ?? false);
  const [staffText, setStaffText] = useState((initial?.staff ?? []).join('\n'));
  const staff = useMemo(() => parseStaffText(staffText), [staffText]);
  const staffFile = useRef<HTMLInputElement>(null);
  const [company, setCompany] = useState(initial?.company ?? '');
  const [logo, setLogo] = useState<string | null>(initial?.logo ?? null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoFile = useRef<HTMLInputElement>(null);
  const [hours, setHours] = useState<OpenHours>(initial?.hours ?? DEFAULT_HOURS);
  const alwaysOpen = hours[1] - hours[0] >= 24;

  const stats = useMemo(() => buildRace(built.lines, start, end).totals, [built, start, end]);
  const valid = end > start && stats.lines > 0;

  const groups = (['day', 'weekend', 'week'] as const).map((g) => ({ g, items: presets.filter((p) => p.group === g) }));
  // Only one suggestion is marked as chosen, even when two cover the same range
  const chosen = presets.find((p) => p.start === start && p.end === end) ?? null;

  return (
    <section className="panel setup">
      <h2>Vælg periode</h2>

      <div className="preset-row">
        <button
          className={`chip big ${chosen === presets[0] ? 'on' : ''}`}
          onClick={() => {
            setStart(presets[0].start);
            setEnd(presets[0].end);
          }}
        >
          Hele perioden
        </button>
      </div>
      {groups.map(
        ({ g, items }) =>
          items.length > 0 && (
            <div key={g} className="preset-group">
              <span className="group-label">{GROUP_LABEL[g]}</span>
              <div className="chips">
                {items.map((p) => (
                  <button
                    key={p.label + p.start}
                    className={`chip ${chosen === p ? 'on' : ''}`}
                    onClick={() => {
                      setStart(p.start);
                      setEnd(p.end);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ),
      )}

      <div className="custom-range">
        <label>
          Fra
          <input
            type="datetime-local"
            value={toInputValue(start)}
            onChange={(e) => {
              const t = fromInputValue(e.target.value);
              if (t !== null) setStart(t);
            }}
          />
        </label>
        <label>
          Til
          <input
            type="datetime-local"
            value={toInputValue(end)}
            onChange={(e) => {
              const t = fromInputValue(e.target.value);
              if (t !== null) setEnd(t);
            }}
          />
        </label>
      </div>

      <div className={`period-summary ${valid ? '' : 'empty'}`}>
        <span>{fmtRange(start, end)}</span>
        {valid ? (
          <span>
            <b>{fmtInt(stats.orders)}</b> ordrer · <b>{fmtInt(stats.units)}</b> varer
            {showRevenue && stats.revenue !== null && <> · <b>{fmtKr(stats.revenue)}</b></>}
          </span>
        ) : (
          <span>{end <= start ? 'Slut skal være efter start' : 'Ingen ordrer i perioden'}</span>
        )}
      </div>

      <h3>Afspilning</h3>
      <div className="setup-opts">
        <div className="opt-block">
          <span className="group-label">Varighed</span>
          <div className="seg">
            {DURATIONS.map((d) => (
              <button key={d} className={durationSec === d ? 'on' : ''} onClick={() => setDuration(d)}>
                {d} sek.
              </button>
            ))}
          </div>
        </div>
        <label className={`toggle ${hasAmount ? '' : 'disabled'}`} title={hasAmount ? '' : 'Ingen beløbskolonne valgt'}>
          <input
            type="checkbox"
            checked={showRevenue && hasAmount}
            disabled={!hasAmount}
            onChange={(e) => setShowRevenue(e.target.checked)}
          />
          <span className="switch" />
          Vis omsætning
        </label>
      </div>

      <h3>Lagerets åbningstid</h3>
      <div className="setup-opts">
        <label className="hours">
          Fra
          <select value={hours[0]} disabled={alwaysOpen} onChange={(e) => setHours([+e.target.value, hours[1]])}>
            {HOUR_OPTIONS.slice(0, 24).map((h) => <option key={h} value={h}>kl. {String(h).padStart(2, '0')}</option>)}
          </select>
          til
          <select value={hours[1]} disabled={alwaysOpen} onChange={(e) => setHours([hours[0], +e.target.value])}>
            {HOUR_OPTIONS.slice(1).map((h) => <option key={h} value={h}>kl. {String(h).padStart(2, '0')}</option>)}
          </select>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={alwaysOpen} onChange={(e) => setHours(e.target.checked ? [0, 24] : DEFAULT_HOURS)} />
          <span className="switch" />
          Døgnåbent
        </label>
      </div>
      <p className="muted small hint">Uden for åbningstiden går alle hjem, og nattens ordrer pakkes næste morgen.</p>

      <h3>Virksomhed (valgfrit)</h3>
      <div className="company">
        <input
          className="text"
          value={company}
          maxLength={40}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Virksomhedens navn"
        />
        <button className="ghost" onClick={() => logoFile.current?.click()}>{logo ? 'Skift logo' : 'Tilføj logo'}</button>
        {logo && (
          <>
            <img className="logo-preview" src={logo} alt="Logo" />
            <button className="link" onClick={() => setLogo(null)}>Fjern</button>
          </>
        )}
        <input
          ref={logoFile}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (f.size > MAX_LOGO_BYTES) return setLogoError('Logoet må højst fylde 2 MB.');
            setLogoError(null);
            const r = new FileReader();
            r.onload = () => setLogo(String(r.result));
            r.readAsDataURL(f);
          }}
        />
      </div>
      {logoError && <p className="error small">{logoError}</p>}
      <p className="muted small hint">Vises på skiltene, varevognen og i finalen. Gemmes ikke.</p>

      <h3>Medarbejdere (valgfrit)</h3>
      <div className="staff">
        <textarea
          value={staffText}
          onChange={(e) => setStaffText(e.target.value)}
          placeholder={'Ét navn pr. linje, fx\nAnna\nMikkel\nSara'}
          rows={4}
          spellCheck={false}
        />
        <div className="staff-side">
          <button className="ghost" onClick={() => staffFile.current?.click()}>Importér CSV</button>
          <input
            ref={staffFile}
            type="file"
            accept=".csv,.txt,text/csv"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) setStaffText(parseStaffCsv(decodeBytes(await f.arrayBuffer())).join('\n'));
            }}
          />
          <p className="muted small">
            {staff.length > MAX_ON_FLOOR
              ? `${fmtInt(staff.length)} navne · ${MAX_ON_FLOOR} på gulvet ad gangen, holdene skifter undervejs.`
              : staff.length > 0
                ? `${staff.length} navne på gulvet.`
                : 'Uden navne: anonyme figurer efter travlhed.'}
            <br />
            Opgaverne fordeles tilfældigt, ikke efter hvem der plukkede hvad. Højst {fmtInt(MAX_STAFF)}. Gemmes ikke.
          </p>
        </div>
      </div>

      <div className="actions sticky-actions">
        <span className="muted small">
          {valid ? <>{fmtRange(start, end)} · <b>{fmtInt(stats.orders)}</b> ordrer</> : 'Vælg en periode med ordrer'}
        </span>
        <button
          className="primary big"
          disabled={!valid}
          onClick={() => onStart({ start, end, durationSec, showRevenue: showRevenue && hasAmount, staff, company: company.trim(), logo, hours })}
        >
          Afspil periode
        </button>
      </div>
    </section>
  );
}
