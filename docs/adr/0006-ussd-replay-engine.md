# 6. USSD as a replay engine

## Context

Most farmers have basic phones and no data. USSD gateways such as Africa's Talking send the whole input path on every
request (`text=1*2*8*1`), sessions time out quickly, and a request can be retried by the network.

## Decision

- The menu engine (`src/ussd/engine.ts`) rebuilds the screen from the first input every time. There is no session
  store to lose or expire. `0` goes back, `00` goes home.
- Menus are nodes with `render` and `next`; side effects (register, pledge, share a record) happen only on a final
  confirmation and are idempotent: a pledge's key is the session id plus the order and quantity, so a retried request
  returns the same pledge.
- All words live in `src/ussd/i18n.ts` in English, Ichibemba and Chinyanja. Tests render every screen in every
  language with worst-case data and fail if one exceeds 182 characters (`tests/unit/ussd.test.ts`).
- The endpoint speaks Africa's Talking's format exactly, so the in-browser phone and a real gateway hit the same code.

## Consequences

The engine is a pure function of (data, inputs), which makes it easy to test and impossible to desynchronise. The
Bemba and Nyanja wording needs a native speaker's review before real use.
