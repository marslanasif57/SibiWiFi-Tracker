
export type SiblingId = 'NI' | 'AM' | 'AD' | 'SB';

export interface Sibling {
  id: SiblingId;
  name: string;
  weight: number;
}

export const SIBLINGS: Sibling[] = [
  { id: 'NI', name: 'NI', weight: 2 },
  { id: 'AM', name: 'AM', weight: 2 },
  { id: 'AD', name: 'AD', weight: 1 },
  { id: 'SB', name: 'SB', weight: 1 },
];

export const TOTAL_SHARES = 6;

export interface MonthlyRecord {
  month: string; // Format: "Month YYYY"
  totalBill: number;
  expected: Record<SiblingId, number>;
  paid: Record<SiblingId, number>;
  balanceCarryForward: Record<SiblingId, number>;
}

export interface GlobalBalance {
  currentOwed: Record<SiblingId, number>;
}
