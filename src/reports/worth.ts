/**
 * What the store is worth on paper: the stock at what it cost, plus what customers owe, minus what
 * the store owes suppliers. All in poisha.
 *
 * Advances count: a customer who paid ahead is money the store owes them (it lowers the figure),
 * and a supplier who was paid ahead owes the store goods (it raises it). Cash and bank balances are
 * not tracked by the app, so they are not in it.
 */
export interface WorthInput {
  /** Stock valued at purchase price. */
  stockCost: number;
  customersOwed: number;
  customersAdvance: number;
  suppliersOwed: number;
  suppliersAdvance: number;
}

export interface Worth {
  /** Customers net: what they owe minus what they paid ahead. */
  customers: number;
  /** Suppliers net: what the store owes minus what it paid ahead. */
  suppliers: number;
  total: number;
}

export function storeWorth(input: WorthInput): Worth {
  const customers = input.customersOwed - input.customersAdvance;
  const suppliers = input.suppliersOwed - input.suppliersAdvance;
  return {
    customers,
    suppliers,
    total: input.stockCost + customers - suppliers,
  };
}
