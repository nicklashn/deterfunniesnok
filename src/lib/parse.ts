/**
 * Parse a number written in Danish or English notation.
 * "1.234,50" → 1234.5, "1,234.50" → 1234.5, "49,95" → 49.95, "49.95" → 49.95, "kr 120" → 120.
 * With only one kind of separator, a comma is treated as decimal (Danish default) and so is a single dot.
 */
export function parseNumber(raw: string): number | null {
  if (raw == null) return null;
  let s = raw.replace(/[\s\u00a0']/g, '').replace(/[^0-9,.\-+]/g, '')
    .replace(/[.,]-$/, '')
    .replace(/^[.,]+|[.,]+$/g, ''); // e.g. "kr. 120" or "120,-"
  if (s === '' || s === '-' || s === '+') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = (s.match(/,/g)!.length > 1) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot >= 0 && s.match(/\./g)!.length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const ISO_LOCAL = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?)?$/;
const EUROPEAN = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:[ T,]+(?:kl\.?\s*)?(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/i;

function local(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const dt = new Date(y, mo - 1, d, h, mi, s);
  // Reject overflow such as 31-02-2025
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt.getTime();
}

/**
 * Parse an order timestamp. Times without an explicit zone are read as the browser's local time.
 * Supports ISO 8601 (with or without zone), DD-MM-YYYY / DD.MM.YYYY / DD/MM/YYYY with optional time,
 * and Unix timestamps in seconds or milliseconds.
 */
export function parseDate(raw: string): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  if (/^\d{13}$/.test(s)) return Number(s);

  let m = ISO_LOCAL.exec(s);
  if (m) return local(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));

  // ISO with explicit zone (Z or ±hh:mm) — let the engine handle the offset.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    // Normalise "+0100" to "+01:00" (Shopify writes the former; Safari only parses the latter)
    const t = Date.parse(s.replace(' ', 'T').replace(/\s+/, '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return Number.isNaN(t) ? null : t;
  }

  m = EUROPEAN.exec(s);
  if (m) return local(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));

  return null;
}
