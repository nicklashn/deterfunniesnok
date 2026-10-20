/**
 * Packing timeline for the warehouse view. Every real order is packed exactly once; only *when*
 * is modelled: orders are packed in arrival order at a fixed pace during opening hours, so the
 * night's orders become a morning backlog. Counts derived from this are exact order counts.
 */
import { HOUR } from './race';
import { isOpen, nextOpening, type OpenHours } from './hours';

/** Packing pace (orders per hour): a little above the busiest hour, so the day's queue clears. */
export function packingRate(peakOrdersPerHour: number): number {
  return Math.max(6, Math.ceil(peakOrdersPerHour * 1.2));
}

/** Time each order (sorted arrival times) is packed. Non-decreasing. */
export function planPacking(orderTimes: number[], hours: OpenHours, ratePerHour: number): number[] {
  const gap = HOUR / ratePerHour;
  const out = new Array<number>(orderTimes.length);
  let free = -Infinity;
  for (let i = 0; i < orderTimes.length; i++) {
    let at = Math.max(orderTimes[i], free);
    if (!isOpen(hours, at)) at = nextOpening(hours, at);
    out[i] = at;
    free = at + gap;
  }
  return out;
}

/** Number of orders packed at or before t. */
export function packedAt(packed: number[], t: number): number {
  let lo = 0;
  let hi = packed.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (packed[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
