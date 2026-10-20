import { parseDate, parseNumber } from './parse';
import type { AmountMode, Field, Mapping, OrderLine } from './types';

export const FIELDS: { key: Field; label: string; required: boolean; hint?: string }[] = [
  { key: 'time', label: 'Ordretidspunkt', required: true },
  { key: 'orderId', label: 'Ordre-ID', required: true, hint: 'Bruges til at tælle unikke ordrer' },
  { key: 'product', label: 'Produktnavn', required: true },
  { key: 'qty', label: 'Antal', required: true },
  { key: 'amount', label: 'Beløb', required: false, hint: 'Valgfri – kun til omsætning' },
  { key: 'imageUrl', label: 'Produktbillede-URL', required: false, hint: 'Valgfri' },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9æøå]/g, '');

const SYNONYMS: Record<Field, string[]> = {
  time: ['ordretidspunkt', 'tidspunkt', 'ordredato', 'ordretid', 'oprettet', 'dato', 'tid', 'createdat', 'orderdate', 'ordertime', 'orderedat', 'paidat', 'processedat', 'timestamp', 'datetime', 'date', 'time', 'created'],
  orderId: ['ordreid', 'ordrenr', 'ordrenummer', 'ordre', 'orderid', 'ordernumber', 'orderno', 'ordernr', 'order', 'bestillingsnr'],
  product: ['produktnavn', 'produkt', 'varenavn', 'vare', 'productname', 'product', 'lineitemname', 'itemname', 'item', 'producttitle', 'title', 'artikel'],
  qty: ['antal', 'stk', 'styk', 'mængde', 'quantity', 'qty', 'lineitemquantity', 'units', 'count'],
  // Line-level amounts first: Shopify's "Total" is the whole order and only sits on its first line
  amount: ['linjebeløb', 'linjetotal', 'linetotal', 'lineitemtotal', 'lineitemprice', 'beløb', 'belob', 'omsætning', 'total', 'revenue', 'amount', 'sum', 'pris', 'price', 'subtotal'],
  imageUrl: ['produktbilledeurl', 'produktbillede', 'billedurl', 'billede', 'imageurl', 'image', 'imagesrc', 'img', 'picture', 'thumbnail'],
};

/** Columns that look like customer data are never offered for mapping and never read. */
const CUSTOMER = /kunde|customer|email|mail|adresse|address|telefon|phone|mobil|billing|shipping|fornavn|efternavn|firstname|lastname|postnr|zip|city|by$|land$|country|cvr/;

export function isCustomerColumn(header: string): boolean {
  return CUSTOMER.test(norm(header));
}

/** Shopify's order export: one row per line item, with "Lineitem …" columns. */
const isShopify = (headers: string[]) => headers.some((h) => norm(h).startsWith('lineitem'));

export function autoDetect(headers: string[]): Mapping {
  const mapping: Mapping = { time: null, orderId: null, product: null, qty: null, amount: null, imageUrl: null };
  const used = new Set<number>();
  const candidates = headers.map((h, i) => ({ i, n: norm(h) })).filter((c) => !isCustomerColumn(headers[c.i]) && c.n);

  // In a Shopify export the order number ("#1001") is the column called just "Name"
  if (isShopify(headers)) {
    const name = candidates.find((c) => c.n === 'name');
    if (name) {
      mapping.orderId = name.i;
      used.add(name.i);
    }
  }

  // Two passes: exact synonym matches first, then "contains" matches.
  for (const exact of [true, false]) {
    for (const field of Object.keys(SYNONYMS) as Field[]) {
      if (mapping[field] !== null) continue;
      for (const syn of SYNONYMS[field]) {
        const hit = candidates.find((c) => !used.has(c.i) && (exact ? c.n === syn : c.n.includes(syn)));
        if (hit) {
          mapping[field] = hit.i;
          used.add(hit.i);
          break;
        }
      }
    }
  }
  return mapping;
}

/** Price columns hold the price per item; everything else is taken as the line total. */
export function guessAmountMode(headers: string[], mapping: Mapping): AmountMode {
  if (mapping.amount === null) return 'line';
  const n = norm(headers[mapping.amount]);
  if (n === 'lineitemprice') return 'unit';
  if (/total|sum|beløb|belob|omsætning|revenue|amount/.test(n)) return 'line';
  return /price|pris/.test(n) ? 'unit' : 'line';
}

export interface BuildResult {
  lines: OrderLine[];
  skipped: { time: number; orderId: number; product: number; qty: number };
  total: number;
}

export function buildLines(rows: string[][], mapping: Mapping, amountMode: AmountMode): BuildResult {
  const skipped = { time: 0, orderId: 0, product: 0, qty: 0 };
  const lines: OrderLine[] = [];
  const cell = (row: string[], f: Field) => (mapping[f] === null ? '' : (row[mapping[f]!] ?? '').trim());

  for (const row of rows) {
    const time = parseDate(cell(row, 'time'));
    if (time === null) { skipped.time++; continue; }
    const orderId = cell(row, 'orderId');
    if (!orderId) { skipped.orderId++; continue; }
    const product = cell(row, 'product');
    if (!product) { skipped.product++; continue; }
    const qty = parseNumber(cell(row, 'qty'));
    if (qty === null || qty <= 0) { skipped.qty++; continue; }

    let amount: number | null = null;
    if (mapping.amount !== null) {
      const a = parseNumber(cell(row, 'amount'));
      if (a !== null) amount = amountMode === 'unit' ? a * qty : a;
    }
    const img = cell(row, 'imageUrl');
    lines.push({ time, orderId, product, qty, amount, imageUrl: /^https?:\/\//i.test(img) ? img : null });
  }
  return { lines, skipped, total: rows.length };
}

export function missingRequired(mapping: Mapping): Field[] {
  return FIELDS.filter((f) => f.required && mapping[f.key] === null).map((f) => f.key);
}
