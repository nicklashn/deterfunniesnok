import { useMemo } from 'react';
import type { ParsedCsv } from '../lib/csv';
import { FIELDS, buildLines, isCustomerColumn, missingRequired } from '../lib/mapping';
import { fmtInt, fmtKr, fmtShort } from '../lib/format';
import type { AmountMode, Field, Mapping } from '../lib/types';

interface Props {
  csv: ParsedCsv;
  mapping: Mapping;
  amountMode: AmountMode;
  onChange: (m: Mapping) => void;
  onAmountMode: (m: AmountMode) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function MappingScreen({ csv, mapping, amountMode, onChange, onAmountMode, onBack, onContinue }: Props) {
  const usable = csv.headers.map((h, i) => ({ h, i })).filter(({ h }) => !isCustomerColumn(h));
  const ignored = csv.headers.filter((h) => isCustomerColumn(h));
  const missing = missingRequired(mapping);

  const preview = useMemo(
    () => (missing.length ? null : buildLines(csv.rows, mapping, amountMode)),
    [csv, mapping, amountMode, missing.length],
  );
  const skippedTotal = preview ? Object.values(preview.skipped).reduce((a, b) => a + b, 0) : 0;

  const set = (field: Field, value: string) => {
    const idx = value === '' ? null : Number(value);
    const next = { ...mapping };
    // A column can only be used once
    for (const f of Object.keys(next) as Field[]) if (idx !== null && next[f] === idx) next[f] = null;
    next[field] = idx;
    onChange(next);
  };

  return (
    <section className="panel mapping">
      <h2>Kolonnetilknytning</h2>
      <p className="muted">
        Vi har gættet ud fra kolonnenavnene. Ret til, hvis noget er forkert. {fmtInt(csv.rows.length)} rækker fundet.
      </p>

      <div className="map-grid">
        {FIELDS.map((f) => (
          <label key={f.key} className={`map-row ${f.required && mapping[f.key] === null ? 'missing' : ''}`}>
            <span className="map-label">
              {f.label}
              {f.required ? <em>påkrævet</em> : <em className="opt">valgfri</em>}
              {f.hint && <small>{f.hint}</small>}
            </span>
            <select value={mapping[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">— ingen —</option>
              {usable.map(({ h, i }) => (
                <option key={i} value={i}>
                  {h || `Kolonne ${i + 1}`}
                  {csv.rows[0]?.[i] ? `  ·  fx "${csv.rows[0][i].slice(0, 28)}"` : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {mapping.amount !== null && (
        <div className="amount-mode">
          <span>Beløbskolonnen er</span>
          <div className="seg">
            <button className={amountMode === 'line' ? 'on' : ''} onClick={() => onAmountMode('line')}>
              linjens total
            </button>
            <button className={amountMode === 'unit' ? 'on' : ''} onClick={() => onAmountMode('unit')}>
              pris pr. stk.
            </button>
          </div>
        </div>
      )}

      {ignored.length > 0 && (
        <p className="ignored">
          Ignoreres (kundedata): {ignored.map((h) => <code key={h}>{h}</code>)}
        </p>
      )}

      {preview && (
        <div className="preview">
          <div className="preview-head">
            <strong>{fmtInt(preview.lines.length)} gyldige ordrelinjer</strong>
            {skippedTotal > 0 && (
              <span className="warn">
                {fmtInt(skippedTotal)} sprunget over:{' '}
                {[
                  preview.skipped.time && `${preview.skipped.time} uden gyldigt tidspunkt`,
                  preview.skipped.orderId && `${preview.skipped.orderId} uden ordre-ID`,
                  preview.skipped.product && `${preview.skipped.product} uden produkt`,
                  preview.skipped.qty && `${preview.skipped.qty} med antal ≤ 0 eller ugyldigt`,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            )}
          </div>
          <table>
            <thead>
              <tr>
                <th>Tidspunkt</th>
                <th>Ordre</th>
                <th>Produkt</th>
                <th>Antal</th>
                {mapping.amount !== null && <th>Beløb</th>}
              </tr>
            </thead>
            <tbody>
              {preview.lines.slice(0, 5).map((l, i) => (
                <tr key={i}>
                  <td>{fmtShort(l.time)}</td>
                  <td>{l.orderId}</td>
                  <td>{l.product}</td>
                  <td>{fmtInt(l.qty)}</td>
                  {mapping.amount !== null && <td>{l.amount === null ? '–' : fmtKr(l.amount)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="actions">
        <button className="ghost" onClick={onBack}>← Anden fil</button>
        <button
          className="primary"
          disabled={missing.length > 0 || !preview?.lines.length}
          onClick={onContinue}
        >
          Fortsæt til periode →
        </button>
      </div>
      {missing.length > 0 && (
        <p className="error">Vælg kolonne for: {missing.map((k) => FIELDS.find((f) => f.key === k)!.label).join(', ')}</p>
      )}
    </section>
  );
}
