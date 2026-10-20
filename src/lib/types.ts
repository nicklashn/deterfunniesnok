/** One product line from an order, after parsing and column mapping. */
export interface OrderLine {
  time: number; // epoch ms
  orderId: string;
  product: string;
  qty: number;
  /** Line total (already multiplied by qty if the source column was a unit price). */
  amount: number | null;
  imageUrl: string | null;
}

export type Field = 'time' | 'orderId' | 'product' | 'qty' | 'amount' | 'imageUrl';

/** Column index per field, or null when not mapped. */
export type Mapping = Record<Field, number | null>;

export type AmountMode = 'line' | 'unit';
