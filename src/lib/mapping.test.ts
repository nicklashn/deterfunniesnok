import { describe, expect, it } from 'vitest';
import { autoDetect, guessAmountMode, isCustomerColumn } from './mapping';
import { parseDate } from './parse';

// Header row of a Shopify order export (shortened)
const SHOPIFY = ['Name', 'Email', 'Financial Status', 'Paid at', 'Currency', 'Subtotal', 'Shipping', 'Taxes', 'Total',
  'Created at', 'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Lineitem sku', 'Billing Name', 'Shipping Name',
  'Shipping Address1', 'Phone'];

describe('column mapping', () => {
  it('reads a Shopify export: order number from "Name", per-item price, no customer columns', () => {
    const m = autoDetect(SHOPIFY);
    const col = (i: number | null) => (i === null ? null : SHOPIFY[i]);
    expect(col(m.orderId)).toBe('Name');
    expect(col(m.product)).toBe('Lineitem name');
    expect(col(m.qty)).toBe('Lineitem quantity');
    expect(col(m.amount)).toBe('Lineitem price');
    expect(guessAmountMode(SHOPIFY, m)).toBe('unit');
    for (const h of ['Email', 'Billing Name', 'Shipping Name', 'Shipping Address1', 'Phone']) expect(isCustomerColumn(h)).toBe(true);
    for (const i of Object.values(m)) if (i !== null) expect(isCustomerColumn(SHOPIFY[i])).toBe(false);
  });

  it('does not take a plain "Name" column as the order ID outside Shopify', () => {
    const headers = ['Dato', 'Name', 'Ordrenr', 'Produkt', 'Antal'];
    expect(headers[autoDetect(headers).orderId!]).toBe('Ordrenr');
  });

  it('treats line totals as totals and unit prices as unit prices', () => {
    const h = ['Ordredato', 'Ordrenr', 'Produkt', 'Antal', 'Linjebeløb (DKK)'];
    expect(guessAmountMode(h, autoDetect(h))).toBe('line');
    const u = ['Ordredato', 'Ordrenr', 'Produkt', 'Antal', 'Stykpris'];
    expect(guessAmountMode(u, autoDetect(u))).toBe('unit');
  });

  it('parses Shopify timestamps with a compact UTC offset', () => {
    expect(parseDate('2025-11-28 07:00:00 +0100')).toBe(Date.UTC(2025, 10, 28, 6));
  });
});
