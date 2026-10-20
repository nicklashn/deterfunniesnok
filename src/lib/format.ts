const int = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });
const kr = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 });
const clock = new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
const short = new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const fmtInt = (n: number) => int.format(n);
export const fmtKr = (n: number) => kr.format(n);
export const fmtClock = (t: number) => clock.format(t);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const fmtDay = (t: number) => cap(day.format(t));
export const fmtShort = (t: number) => short.format(t);

export function fmtRange(start: number, end: number): string {
  return cap(`${fmtShort(start)} – ${fmtShort(end)}`);
}

/** Stable hue per product name for bar colours and fallback cards. */
export function hueFor(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0) % 360;
}

export function initials(name: string): string {
  const words = name.replace(/["“”'()]/g, '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}

/** datetime-local input value <-> epoch ms (local time) */
export function toInputValue(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromInputValue(v: string): number | null {
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}
