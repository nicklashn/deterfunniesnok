/** Warehouse opening hours as whole local hours [from, to); 0–24 means always open. */
export type OpenHours = [number, number];

export const DEFAULT_HOURS: OpenHours = [7, 22];

const hourOf = (t: number) => {
  const d = new Date(t);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
};

export function isOpen([from, to]: OpenHours, t: number): boolean {
  if (to - from >= 24) return true;
  const h = hourOf(t);
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** Next opening time after t (for "closed until" labels). */
export function nextOpening([from]: OpenHours, t: number): number {
  const d = new Date(t);
  d.setHours(from, 0, 0, 0);
  if (d.getTime() <= t) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** A pickup on the hour is allowed while open, including exactly at closing time. */
export function pickupAllowed(hours: OpenHours, t: number): boolean {
  return isOpen(hours, t) || isOpen(hours, t - 1);
}
