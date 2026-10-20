import { parseCsv } from './csv';

export const MAX_STAFF = 500;
/** Figures on the floor at once; larger teams take turns in shifts. */
export const MAX_ON_FLOOR = 36;
const MAX_NAME = 24;

/** One name per line; blank lines and duplicates dropped, long names trimmed. */
export function parseStaffText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    const key = name.toLocaleLowerCase('da');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_STAFF) break;
  }
  return out;
}

const NAME_HEADER = /^(navn|name|medarbejder|employee|fornavn|first ?name|fulde navn|full ?name)$/i;

/**
 * Reads names from a CSV export. Uses a column whose header looks like a name column,
 * otherwise the first column (then the first row is treated as data unless it is a known header).
 * Other columns (e-mail, phone …) are never read.
 */
export function parseStaffCsv(text: string): string[] {
  const { headers, rows } = parseCsv(text);
  let col = headers.findIndex((h) => NAME_HEADER.test(h.trim()));
  let data = rows;
  if (col < 0) {
    col = 0;
    data = [headers, ...rows];
  }
  return parseStaffText(data.map((r) => r[col] ?? '').join('\n'));
}

/** Deterministic shuffle so names are spread randomly over the figures, the same way on every replay. */
export function shuffleNames(names: string[], seed: number): string[] {
  const out = [...names];
  let s = seed % 2147483647 || 1;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
