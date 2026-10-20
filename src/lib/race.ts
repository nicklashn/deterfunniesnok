/**
 * Pure race calculations. Nothing here knows about animation: the player only asks
 * "what is the state at time t?" and gets exact numbers back.
 */
import type { OrderLine } from './types';

export interface ProductInfo {
  id: number;
  name: string;
  imageUrl: string | null;
  units: number;
  revenue: number;
}

/** Step function: cum[i] = total up to and including times[i]. */
export interface Series {
  times: number[];
  cum: number[];
}

export type RaceEvent =
  | { kind: 'first'; time: number; productId: number; orderId: string }
  | { kind: 'lead'; time: number; productId: number; prevId: number; units: number; prevUnits: number }
  | { kind: 'busiest'; time: number; end: number; orders: number };

export interface HourBucket {
  start: number;
  orders: number;
  units: number;
}

export interface RaceData {
  start: number;
  end: number;
  products: ProductInfo[];
  series: Series[];
  /** First-seen time of each unique order ID, sorted. */
  orderTimes: number[];
  units: Series;
  revenue: Series | null;
  events: RaceEvent[];
  hourly: HourBucket[];
  busiest: HourBucket | null;
  totals: {
    orders: number;
    units: number;
    lines: number;
    revenue: number | null;
    /** Lines in the period without a parsable amount (revenue is then a lower bound). */
    linesWithoutAmount: number;
  };
}

export interface Standing {
  productId: number;
  units: number;
  /** Time the product reached its current count (Infinity if it has sold nothing). */
  reachedAt: number;
}

export const HOUR = 3_600_000;

export function floorHour(t: number): number {
  const d = new Date(t);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/** Index of the last element <= t, or -1. */
function upperIndex(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function valueAt(s: Series, t: number): number {
  const i = upperIndex(s.times, t);
  return i < 0 ? 0 : s.cum[i];
}

export function ordersAt(data: RaceData, t: number): number {
  return upperIndex(data.orderTimes, t) + 1;
}

/**
 * Ranking rule used everywhere (live standings, leader changes, podium):
 * more units first; on a tie the product that reached that count first stays ahead; then name.
 */
export function compareStandings(a: Standing, b: Standing, products: ProductInfo[]): number {
  return (
    b.units - a.units ||
    a.reachedAt - b.reachedAt ||
    products[a.productId].name.localeCompare(products[b.productId].name, 'da')
  );
}

export function standingsAt(data: RaceData, t: number): Standing[] {
  const list = data.series.map((s, productId) => {
    const i = upperIndex(s.times, t);
    return i < 0
      ? { productId, units: 0, reachedAt: Infinity }
      : { productId, units: s.cum[i], reachedAt: s.times[i] };
  });
  return list.sort((a, b) => compareStandings(a, b, data.products));
}

/** Build all race data for lines with start <= time < end. */
export function buildRace(allLines: OrderLine[], start: number, end: number): RaceData {
  const lines = allLines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.time >= start && l.time < end)
    .sort((a, b) => a.l.time - b.l.time || a.i - b.i)
    .map(({ l }) => l);

  // Products and their cumulative unit series
  const productIndex = new Map<string, number>();
  const products: ProductInfo[] = [];
  const series: Series[] = [];
  for (const l of lines) {
    let id = productIndex.get(l.product);
    if (id === undefined) {
      id = products.length;
      productIndex.set(l.product, id);
      products.push({ id, name: l.product, imageUrl: null, units: 0, revenue: 0 });
      series.push({ times: [], cum: [] });
    }
    const p = products[id];
    if (!p.imageUrl && l.imageUrl) p.imageUrl = l.imageUrl;
    p.units += l.qty;
    p.revenue += l.amount ?? 0;
    pushStep(series[id], l.time, p.units);
  }

  // Unique orders (by order ID), placed at their first line's time
  const orderFirst = new Map<string, number>();
  for (const l of lines) if (!orderFirst.has(l.orderId)) orderFirst.set(l.orderId, l.time);
  const orderTimes = [...orderFirst.values()].sort((a, b) => a - b);

  // Running totals
  const units: Series = { times: [], cum: [] };
  const hasAmount = lines.some((l) => l.amount !== null);
  const revenue: Series | null = hasAmount ? { times: [], cum: [] } : null;
  let u = 0;
  let r = 0;
  let linesWithoutAmount = 0;
  for (const l of lines) {
    u += l.qty;
    if (l.amount === null) linesWithoutAmount++;
    else r += l.amount;
    pushStep(units, l.time, u);
    if (revenue) pushStep(revenue, l.time, r);
  }

  // Local clock-hour buckets covering the period
  const hourly: HourBucket[] = [];
  for (let h = floorHour(start); h < end; ) {
    hourly.push({ start: h, orders: 0, units: 0 });
    const next = floorHour(h + HOUR + 60_000); // robust to DST shifts
    h = next > h ? next : h + HOUR;
  }
  const starts = hourly.map((b) => b.start);
  for (const t of orderTimes) hourly[upperIndex(starts, t)].orders++;
  for (const l of lines) hourly[upperIndex(starts, l.time)].units += l.qty;

  let busiest: HourBucket | null = null;
  for (const b of hourly) if (b.orders > 0 && (!busiest || b.orders > busiest.orders)) busiest = b;

  // Events: only things that actually happened in the data
  const events: RaceEvent[] = [];
  if (lines.length) {
    events.push({ kind: 'first', time: lines[0].time, productId: productIndex.get(lines[0].product)!, orderId: lines[0].orderId });
  }

  const cnt: number[] = new Array(products.length).fill(0);
  const reached: number[] = new Array(products.length).fill(Infinity);
  let leader = -1;
  for (let i = 0; i < lines.length; ) {
    const t = lines[i].time;
    // Apply every line sharing this timestamp before judging the lead
    for (; i < lines.length && lines[i].time === t; i++) {
      const id = productIndex.get(lines[i].product)!;
      cnt[id] += lines[i].qty;
      reached[id] = t;
    }
    let best = 0;
    for (let id = 1; id < products.length; id++) {
      const c = compareStandings(
        { productId: id, units: cnt[id], reachedAt: reached[id] },
        { productId: best, units: cnt[best], reachedAt: reached[best] },
        products,
      );
      if (c < 0) best = id;
    }
    if (leader === -1) leader = best;
    else if (best !== leader) {
      events.push({ kind: 'lead', time: t, productId: best, prevId: leader, units: cnt[best], prevUnits: cnt[leader] });
      leader = best;
    }
  }

  if (busiest) events.push({ kind: 'busiest', time: busiest.start, end: busiest.start + HOUR, orders: busiest.orders });
  const order = { busiest: 0, first: 1, lead: 2 };
  events.sort((a, b) => a.time - b.time || order[a.kind] - order[b.kind]);

  return {
    start,
    end,
    products,
    series,
    orderTimes,
    units,
    revenue,
    events,
    hourly,
    busiest,
    totals: { orders: orderTimes.length, units: u, lines: lines.length, revenue: hasAmount ? r : null, linesWithoutAmount },
  };
}

function pushStep(s: Series, t: number, value: number) {
  const last = s.times.length - 1;
  if (last >= 0 && s.times[last] === t) s.cum[last] = value;
  else {
    s.times.push(t);
    s.cum.push(value);
  }
}

export interface PeriodPreset {
  label: string;
  group: 'all' | 'day' | 'weekend' | 'week';
  start: number;
  end: number;
}

const DAY_FMT = new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
const DATE_FMT = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short' });

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

function isoWeek(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // Thursday of this week
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

/** Period suggestions derived from the days actually present in the data. */
export function periodPresets(lines: OrderLine[]): PeriodPreset[] {
  if (!lines.length) return [];
  let min = Infinity;
  let max = -Infinity;
  const days = new Set<number>();
  for (const l of lines) {
    if (l.time < min) min = l.time;
    if (l.time > max) max = l.time;
    days.add(startOfDay(l.time));
  }
  const sortedDays = [...days].sort((a, b) => a - b);
  const presets: PeriodPreset[] = [
    { label: 'Hele perioden', group: 'all', start: floorHour(min), end: floorHour(max) + HOUR },
  ];
  if (sortedDays.length < 2) return presets.concat(sortedDays.map((d) => ({ label: DAY_FMT.format(d), group: 'day' as const, start: d, end: addDays(d, 1) })));

  if (sortedDays.length <= 31) {
    for (const d of sortedDays) presets.push({ label: DAY_FMT.format(d), group: 'day', start: d, end: addDays(d, 1) });
  }

  const saturdays = new Set<number>();
  for (const d of sortedDays) {
    const wd = new Date(d).getDay();
    if (wd === 6) saturdays.add(d);
    if (wd === 0) saturdays.add(addDays(d, -1));
  }
  for (const sat of [...saturdays].sort((a, b) => a - b)) {
    presets.push({ label: `Weekend ${DATE_FMT.format(sat)}`, group: 'weekend', start: sat, end: addDays(sat, 2) });
  }

  const mondays = new Set<number>();
  for (const d of sortedDays) mondays.add(addDays(d, -((new Date(d).getDay() + 6) % 7)));
  for (const monday of [...mondays].sort((a, b) => a - b)) {
    presets.push({ label: `Uge ${isoWeek(monday)}`, group: 'week', start: monday, end: addDays(monday, 7) });
  }
  return presets;
}
