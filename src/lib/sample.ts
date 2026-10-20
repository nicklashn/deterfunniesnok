/**
 * Deterministic sample data: a fictional Danish interior webshop during Black Friday week
 * (Mon 24 – Sun 30 Nov 2025). Generated as CSV text so it goes through the exact same
 * parsing and mapping path as an uploaded file. Semicolon-separated with Danish number and
 * date formats, plus a customer column that the app ignores.
 */

interface SampleProduct {
  name: string;
  price: number;
  weight: number;
  /** Multiplier on popularity given weekday (0 = Mon) and hour. */
  boost?: (day: number, hour: number) => number;
  maxQty?: number;
}

const PRODUCTS: SampleProduct[] = [
  { name: 'Duftlys "Vinterskov"', price: 149, weight: 10, boost: (d, h) => (h >= 18 ? 1.5 : 1) * (d <= 2 ? 1.3 : 0.8), maxQty: 3 },
  { name: 'Keramikkop "Sand"', price: 89, weight: 8, maxQty: 4 },
  { name: 'Uldplaid "Fjord"', price: 499, weight: 7, boost: (d) => (d === 3 ? 1.6 : 1) },
  { name: 'Bordlampe "Glød"', price: 1199, weight: 2, boost: (d) => (d === 4 ? 7 : d > 4 ? 1.6 : 0.6) },
  { name: 'Hørviskestykker 3-pak', price: 179, weight: 6, maxQty: 2 },
  { name: 'Termokande "Morgen"', price: 349, weight: 4, boost: (_d, h) => (h < 11 ? 1.8 : 1) },
  { name: 'Lammeskindshynde', price: 399, weight: 3.5, boost: (d) => (d === 5 ? 2.4 : 1) },
  { name: 'Espressokopper 2 stk.', price: 249, weight: 4 },
  { name: 'Gavekort 500 kr.', price: 500, weight: 2.2, boost: (d, h) => (d === 6 ? 4 + (h >= 19 ? 3 : 0) : 1) },
  { name: 'Juledekoration "Kogle"', price: 79, weight: 3, boost: (d) => 0.6 + d * 0.35, maxQty: 5 },
  { name: 'Uldhjemmesko', price: 299, weight: 3, boost: (d) => (d >= 5 ? 2 : 1) },
  { name: 'Linneddug "Mark"', price: 459, weight: 2.5 },
];

// Orders per hour shape (0–23) and per weekday (Mon–Sun)
const HOURLY = [0.3, 0.2, 0.1, 0.1, 0.1, 0.2, 0.5, 1, 1.5, 2, 2.4, 2.6, 3, 2.6, 2.4, 2.4, 2.6, 3, 3.4, 4, 4.2, 3.6, 2.4, 1.2];
const DAILY = [1, 0.95, 1.05, 1.3, 3.1, 1.8, 1.6];
const SCALE = 3.3;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(rand: () => number, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (d: Date) =>
  `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fmtKr = (n: number) =>
  n.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
const csvCell = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function generateSampleCsv(): string {
  const rand = mulberry32(20251128);
  const rows: string[] = ['Ordredato;Ordrenr;Kundenavn;Produkt;Antal;Linjebeløb (DKK)'];
  let orderNo = 10421;

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      let rate = HOURLY[hour] * DAILY[day] * SCALE;
      if (day === 4 && hour === 0) rate *= 9; // Black Friday opens at midnight
      if (day === 4 && hour >= 6 && hour <= 9) rate *= 1.4; // morning newsletter
      const n = poisson(rand, rate);
      const seconds = Array.from({ length: n }, () => Math.floor(rand() * 3600)).sort((a, b) => a - b);

      for (const sec of seconds) {
        const date = new Date(2025, 10, 24 + day, hour, 0, sec);
        const weights = PRODUCTS.map((p) => p.weight * (p.boost ? p.boost(day, hour) : 1));
        const total = weights.reduce((a, b) => a + b, 0);
        const lineCount = rand() < 0.62 ? 1 : rand() < 0.75 ? 2 : 3;
        const chosen = new Set<number>();
        while (chosen.size < lineCount) {
          let x = rand() * total;
          let i = 0;
          while (x > weights[i]) x -= weights[i++];
          chosen.add(Math.min(i, PRODUCTS.length - 1));
        }
        const id = `#${orderNo++}`;
        const customer = `Kunde ${1000 + Math.floor(rand() * 9000)}`;
        for (const i of chosen) {
          const p = PRODUCTS[i];
          const qty = rand() < 0.78 ? 1 : 1 + Math.floor(rand() * (p.maxQty ?? 2));
          const discount = day === 4 ? 0.75 : day >= 5 ? 0.85 : 1;
          const amount = Math.round(p.price * discount) * qty;
          rows.push([fmtDate(date), id, customer, csvCell(p.name), String(qty), fmtKr(amount)].join(';'));
        }
      }
    }
  }
  return rows.join('\n');
}
