import { describe, expect, it } from 'vitest';
import { packedAt, packingRate, planPacking } from './packing';

const at = (d: number, h: number, m = 0) => new Date(2025, 10, d, h, m).getTime();

describe('packing timeline', () => {
  it('packs day orders right away and night orders from opening time at the set pace', () => {
    const orders = [at(24, 10), at(24, 23), at(25, 2), at(25, 3)];
    const packed = planPacking(orders, [7, 22], 60); // one a minute
    expect(packed).toEqual([at(24, 10), at(25, 7), at(25, 7, 1), at(25, 7, 2)]);
    expect(packedAt(packed, at(25, 6))).toBe(1);
    expect(packedAt(packed, at(25, 7, 1))).toBe(3);
  });

  it('never loses or duplicates an order and never packs while closed', () => {
    const orders = Array.from({ length: 500 }, (_, i) => at(24, 0) + i * 7 * 60_000);
    const packed = planPacking(orders, [7, 22], 30);
    expect(packed).toHaveLength(orders.length);
    packed.forEach((p, i) => {
      expect(p).toBeGreaterThanOrEqual(orders[i]);
      const h = new Date(p).getHours();
      expect(h >= 7 && h < 22).toBe(true);
      if (i) expect(p).toBeGreaterThanOrEqual(packed[i - 1]);
    });
    expect(packedAt(packed, Infinity)).toBe(500);
  });

  it('keeps up with the busiest hour', () => {
    expect(packingRate(42)).toBeGreaterThan(42);
  });
});
