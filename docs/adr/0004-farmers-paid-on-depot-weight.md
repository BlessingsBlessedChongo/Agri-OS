# 4. Farmers are paid on the depot's weight; the weighbridge is signed

## Context

A plant weighbridge weighs a truck carrying many farmers' produce. It cannot say how much each farmer delivered, and
weights are a classic place for fraud: a reading typed in by hand, or produce that leaves the depot and never arrives.

## Decision

- Each farmer's bags are weighed, moisture-checked and graded at the collection depot. That record (with the device
  generated id) is what the farmer is paid on. Moisture above the crop's standard is paid on dry weight; grain that
  is too wet, or below the buyer's minimum grade, is turned away with a reason.
- Responsibility passes to the transporter at the depot. The plant weighbridge weighs the truck loaded and empty; the
  net load is compared with what the depot loaded. A 0.5 % allowance covers dust and handling; loss beyond that is
  valued at the load's average price and deducted from the haulage fee (`src/domain/transport.ts`,
  `src/domain/settlement.ts`), and flagged for review.
- Weighbridge readings are signed by the device (HMAC with a key only the device and Agri-OS share). An unsigned or
  altered reading is refused (`src/server/weighbridge.ts`).

## Consequences

Farmers are never short-paid for something that happened after they handed over their bags. The demo's "Type a weight
by hand" button and the end-to-end script both show a forged reading being refused.
