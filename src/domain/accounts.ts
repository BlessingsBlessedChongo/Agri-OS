/**
 * Chart of accounts. Amounts on ledger lines are signed: debit positive, credit negative.
 * ASSET accounts must never go below zero; LIABILITY and REVENUE accounts must never go above zero
 * (we can't owe someone a negative amount). The database enforces both on every posting.
 */
export type AccountType = 'ASSET' | 'LIABILITY' | 'REVENUE'

export interface AccountRef {
  code: string
  type: AccountType
  name: string
}

export const ACCOUNTS = {
  trust: { code: 'bank:zamtel-trust', type: 'ASSET', name: 'Zamtel Money escrow (trust) wallet' } as AccountRef,
  clearing: { code: 'clearing:payouts', type: 'LIABILITY', name: 'Payouts in flight' } as AccountRef,
  fees: { code: 'revenue:fees', type: 'REVENUE', name: 'Agri-OS service fees' } as AccountRef,
  zra: { code: 'payable:zra', type: 'LIABILITY', name: 'Tax owed to ZRA' } as AccountRef,
  escrow: (orderId: string, ref: string): AccountRef => ({ code: `escrow:order:${orderId}`, type: 'LIABILITY', name: `Escrow for order ${ref}` }),
  farmer: (farmerId: string, name: string): AccountRef => ({ code: `payable:farmer:${farmerId}`, type: 'LIABILITY', name: `Owed to ${name}` }),
  transporter: (id: string, name: string): AccountRef => ({ code: `payable:transporter:${id}`, type: 'LIABILITY', name: `Owed to ${name}` }),
  buyer: (id: string, name: string): AccountRef => ({ code: `payable:buyer:${id}`, type: 'LIABILITY', name: `Refund owed to ${name}` }),
}

export interface Posting {
  account: AccountRef
  amount: number
}

/** True when the balance respects the account's sign rule. */
export function balanceAllowed(type: AccountType, balance: number): boolean {
  return type === 'ASSET' ? balance >= 0 : balance <= 0
}
