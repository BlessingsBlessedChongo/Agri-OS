# 5. Reverse invoicing, and tax as data

## Context

Smallholder farmers have no TPIN and no invoicing device, so they cannot issue a Smart Invoice for a sale. The
original plan also proposed sending "5% of every sale" to ZRA, with no stated legal basis.

## Decision

- The registered buyer issues each purchase invoice **on the farmer's behalf** and submits it to the VSDC
  (`src/integrations/vsdc/client.ts`, `invcKind: PURCHASE_ON_BEHALF`). This is the same idea as "reverse invoicing" in
  Kenya's eTIMS. Haulage and the Agri-OS fee get ordinary sales invoices.
- Invoices are signed with Agri-OS's Ed25519 key after the VSDC accepts them, so the signature covers the receipt
  number. Anyone can check one at `/verify/{id}` (the QR code) or offline with `/api/public/keys`.
- Tax is a table of rules (`src/domain/tax.ts`): what it applies to, the rate, and whether Agri-OS pays it to ZRA at
  settlement or only records it for the seller to file. The defaults are illustrative: VAT on Agri-OS's own fee, VAT
  recorded for VAT-registered hauliers, unprocessed produce treated as exempt, and a withholding on produce that is
  switched **off**. A sandbox can change any rule and see the next settlement follow it.
- Farmers never pay fees. The 1 % fee and its VAT are added to what the buyer pays.

## Consequences

ZRA's value is visibility (a priced, traceable record of trade that used to be cash), not a new levy on farmers. The
real rates and the exact VSDC field mapping must be confirmed with ZRA; both live in one place each.
