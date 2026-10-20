import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { autoDetect, buildLines, isCustomerColumn } from './mapping';
import { parseDate, parseNumber } from './parse';
import { buildRace, ordersAt, periodPresets, standingsAt, valueAt } from './race';
import { generateSampleCsv } from './sample';
import type { OrderLine } from './types';

const t = (h: number, m = 0) => new Date(2025, 10, 28, h, m).getTime();
const line = (time: number, orderId: string, product: string, qty = 1, amount: number | null = null): OrderLine => ({
  time, orderId, product, qty, amount, imageUrl: null,
});

describe('parsing', () => {
  it('parses Danish and English numbers', () => {
    expect(parseNumber('1.198,00')).toBe(1198);
    expect(parseNumber('1,198.00')).toBe(1198);
    expect(parseNumber('49,95')).toBe(49.95);
    expect(parseNumber('49.95')).toBe(49.95);
    expect(parseNumber('kr. 120')).toBe(120);
    expect(parseNumber('120,-')).toBe(120);
    expect(parseNumber('')).toBeNull();
  });

  it('parses common date formats as local time', () => {
    const ref = new Date(2025, 10, 28, 14, 3, 22).getTime();
    expect(parseDate('2025-11-28 14:03:22')).toBe(ref);
    expect(parseDate('2025-11-28T14:03:22')).toBe(ref);
    expect(parseDate('28-11-2025 14:03:22')).toBe(ref);
    expect(parseDate('28.11.2025 14.03.22')).toBe(ref);
    expect(parseDate('2025-11-28T13:03:22Z')).toBe(Date.UTC(2025, 10, 28, 13, 3, 22));
    expect(parseDate('31-02-2025')).toBeNull();
    expect(parseDate('i går')).toBeNull();
  });

  it('parses quoted CSV with semicolons and escaped quotes', () => {
    const csv = parseCsv('﻿A;B\r\n"x;y";"Lys ""Skov"""\r\n\r\n1;2');
    expect(csv.delimiter).toBe(';');
    expect(csv.headers).toEqual(['A', 'B']);
    expect(csv.rows).toEqual([['x;y', 'Lys "Skov"'], ['1', '2']]);
  });

  it('auto-maps columns and skips customer columns', () => {
    const m = autoDetect(['Created at', 'Name', 'Customer email', 'Lineitem name', 'Lineitem quantity', 'Lineitem price']);
    expect(m.time).toBe(0);
    expect(m.product).toBe(3);
    expect(m.qty).toBe(4);
    expect(m.amount).toBe(5);
    expect(isCustomerColumn('Kundenavn')).toBe(true);
    expect(isCustomerColumn('Produktnavn')).toBe(false);
    const dk = autoDetect(['Ordredato', 'Ordrenr', 'Kundenavn', 'Produkt', 'Antal', 'Linjebeløb (DKK)']);
    expect(dk).toEqual({ time: 0, orderId: 1, product: 3, qty: 4, amount: 5, imageUrl: null });
  });

  it('converts unit prices to line totals and skips invalid rows', () => {
    const rows = [
      ['2025-11-28 10:00', 'A', 'Kop', '3', '10'],
      ['ugyldig', 'B', 'Kop', '1', '10'],
      ['2025-11-28 10:00', 'C', 'Kop', '0', '10'],
    ];
    const r = buildLines(rows, { time: 0, orderId: 1, product: 2, qty: 3, amount: 4, imageUrl: null }, 'unit');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].amount).toBe(30);
    expect(r.skipped).toEqual({ time: 1, orderId: 0, product: 0, qty: 1 });
  });
});

describe('race calculations', () => {
  const lines = [
    line(t(9, 5), 'o1', 'Kop', 1, 100),
    line(t(9, 5), 'o1', 'Lys', 1, 50), // same order, same time: tie, Kop stays (alphabetical first at same reach time)
    line(t(10, 0), 'o2', 'Lys', 2, 100), // Lys overtakes
    line(t(10, 30), 'o3', 'Kop', 2, 200), // Kop 3 vs Lys 3 → tie, Lys reached 3 first → no change
    line(t(10, 40), 'o3', 'Kop', 1, 100), // same order again: Kop 4 → overtakes
    line(t(12, 0), 'o4', 'Plaid', 1, null),
    line(t(23, 0), 'udenfor', 'Plaid', 100), // outside period
  ];
  const race = buildRace(lines, t(8), t(13));

  it('counts unique orders by order ID and units', () => {
    expect(race.totals.orders).toBe(4);
    expect(race.totals.units).toBe(8);
    expect(race.totals.revenue).toBe(550);
    expect(race.totals.linesWithoutAmount).toBe(1);
    expect(ordersAt(race, t(10, 35))).toBe(3);
    expect(valueAt(race.units, t(10, 35))).toBe(6);
  });

  it('finds the first order and real leader changes only', () => {
    const lead = race.events.filter((e) => e.kind === 'lead');
    expect(race.events.find((e) => e.kind === 'first')).toMatchObject({ time: t(9, 5), orderId: 'o1' });
    expect(lead.map((e) => race.products[e.productId].name)).toEqual(['Lys', 'Kop']);
    expect(lead.map((e) => e.time)).toEqual([t(10, 0), t(10, 40)]);
  });

  it('standings follow the same tie rule as leader changes', () => {
    const at = (time: number) => standingsAt(race, time).map((s) => race.products[s.productId].name);
    expect(at(t(9, 30))[0]).toBe('Kop');
    expect(at(t(10, 35))[0]).toBe('Lys');
    expect(at(t(12, 59))).toEqual(['Kop', 'Lys', 'Plaid']);
  });

  it('finds the busiest clock hour by unique orders', () => {
    expect(race.busiest).toMatchObject({ start: t(10), orders: 2 });
    expect(race.hourly).toHaveLength(5);
  });

  it('handles an empty period', () => {
    const empty = buildRace(lines, t(1), t(2));
    expect(empty.totals.orders).toBe(0);
    expect(empty.events).toEqual([]);
    expect(empty.busiest).toBeNull();
  });
});

describe('sample data', () => {
  it('parses fully through the normal upload path', () => {
    const csv = parseCsv(generateSampleCsv());
    const mapping = autoDetect(csv.headers);
    const { lines, skipped } = buildLines(csv.rows, mapping, 'line');
    expect(Object.values(skipped).every((n) => n === 0)).toBe(true);
    expect(lines.length).toBe(csv.rows.length);
    const presets = periodPresets(lines);
    expect(presets.filter((p) => p.group === 'day')).toHaveLength(7);
    expect(presets.some((p) => p.group === 'weekend')).toBe(true);
    const race = buildRace(lines, presets[0].start, presets[0].end);
    expect(race.totals.orders).toBeGreaterThan(1000);
    expect(race.events.some((e) => e.kind === 'lead')).toBe(true);
    // Sum of product units equals total units
    expect(race.products.reduce((a, p) => a + p.units, 0)).toBe(race.totals.units);
  });
});

describe('cross-check against a naive count', () => {
  it('Black Friday totals match a direct count of the raw CSV', () => {
    const rows = parseCsv(generateSampleCsv()).rows.filter((r) => r[0].startsWith('28-11-2025'));
    const naiveOrders = new Set(rows.map((r) => r[1])).size;
    const naiveUnits = rows.reduce((a, r) => a + Number(r[4]), 0);
    const perProduct = new Map<string, number>();
    for (const r of rows) perProduct.set(r[3], (perProduct.get(r[3]) ?? 0) + Number(r[4]));

    const csv = parseCsv(generateSampleCsv());
    const { lines } = buildLines(csv.rows, autoDetect(csv.headers), 'line');
    const race = buildRace(lines, new Date(2025, 10, 28).getTime(), new Date(2025, 10, 29).getTime());
    expect(race.totals.orders).toBe(naiveOrders);
    expect(race.totals.units).toBe(naiveUnits);
    const top = standingsAt(race, race.end)[0];
    expect(top.units).toBe(Math.max(...perProduct.values()));
  });
});

describe('staff names', () => {
  it('parses a pasted list and CSV exports without reading other columns', async () => {
    const { parseStaffText, parseStaffCsv, shuffleNames } = await import('./staff');
    expect(parseStaffText(' Anna \n\nMikkel\nanna\n  Sara  Jensen ')).toEqual(['Anna', 'Mikkel', 'Sara Jensen']);
    expect(parseStaffCsv('Navn;E-mail\nAnna;a@x.dk\nMikkel;m@x.dk')).toEqual(['Anna', 'Mikkel']);
    expect(parseStaffCsv('Anna\nMikkel')).toEqual(['Anna', 'Mikkel']);
    const names = ['A', 'B', 'C', 'D'];
    expect(shuffleNames(names, 42)).toEqual(shuffleNames(names, 42));
    expect([...shuffleNames(names, 42)].sort()).toEqual(names);
  });
});

describe('opening hours', () => {
  it('is open within [from, to) and handles always-open and overnight hours', async () => {
    const { isOpen, nextOpening, pickupAllowed } = await import('./hours');
    expect(isOpen([7, 22], t(6, 59))).toBe(false);
    expect(isOpen([7, 22], t(7))).toBe(true);
    expect(isOpen([7, 22], t(21, 59))).toBe(true);
    expect(isOpen([7, 22], t(22))).toBe(false);
    expect(pickupAllowed([7, 22], t(22))).toBe(true);
    expect(pickupAllowed([7, 22], t(23))).toBe(false);
    expect(isOpen([0, 24], t(3))).toBe(true);
    expect(isOpen([20, 6], t(3))).toBe(true);
    expect(isOpen([20, 6], t(12))).toBe(false);
    expect(nextOpening([7, 22], t(23))).toBe(new Date(2025, 10, 29, 7).getTime());
    expect(nextOpening([7, 22], t(5))).toBe(t(7));
  });

  it('accepts large staff lists', async () => {
    const { parseStaffText, MAX_STAFF } = await import('./staff');
    const names = Array.from({ length: 600 }, (_, i) => `Person ${i}`).join('\n');
    expect(parseStaffText(names)).toHaveLength(MAX_STAFF);
  });
});
