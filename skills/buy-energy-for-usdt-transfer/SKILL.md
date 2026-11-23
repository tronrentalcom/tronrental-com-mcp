---
name: buy-energy-for-usdt-transfer
description: Buy TRON energy so that a USDT (TRC-20) transfer burns no TRX. Use when the user is about to send USDT on TRON, asks why a transfer costs several TRX, or wants a cheaper transfer.
---

# Buy energy for a USDT transfer

## Before you start

- The TronRental MCP server must be connected (`get_balance` answers). If it is not, follow https://tronrental.com/skill.md.
- A tool missing from the list means the connection does not have that permission: ask the user to reconnect and allow it. Until the account's top-ups total 100 TRX, a connection can only read (balance, deposit address, deposits): the user tops up first, then reconnects. Spending that runs by itself needs its own permission; if the consent screen does not offer it, the user sets it up in the dashboard.
- Tell the user what it will cost before any call that spends. If the tool takes an `idempotency_key`, pass a new UUID and reuse the same key if you retry that action. A tool without it is not safe to retry blindly: read the state first.
- Calls that spend right away count against the connection's daily cap (100 TRX a day unless the user changed it). `409 AGENT_SPEND_CAP` means the cap has no room for this call: tell the user, who can change the cap in Dashboard → API → Connected apps. Never split a purchase to fit under it.

## Steps

1. Get the sender address (the one that signs the transfer) and, if known, the recipient.
2. `check_address` on the recipient: a recipient that never held USDT needs ~131,000 energy, otherwise ~65,000. For several transfers, multiply.
3. `check_activation` on the sender. An address that is not activated on TRON is activated by the purchase itself, for a separate fee on top of the quote — and `max_price_trx` does not cap that fee. Tell the user before buying.
4. `quote_energy` with that volume and `1h` (enough for a transfer sent right away). Show the user `total_trx`, plus the activation fee if step 3 found the address not activated.
5. On the user's yes: `buy_energy` with the sender as the target, the same volume and duration, `max_price_trx` = the quote's `total_trx`, and an `idempotency_key`.
6. `get_order` until the order is delivered (usually 3–5 seconds), then tell the user to send the transfer within the rental period.

## When it goes wrong

- `409 PRICE_CHANGED`: the price moved, nothing was charged. Quote again and ask the user.
- `422 MAX_PRICE_REQUIRED`: the call had no `max_price_trx`. A connected app must always pass it: quote, then buy with the quote's `total_trx`.
- `409 AGENT_SPEND_CAP`: the purchase (its `max_price_trx`, plus the activation fee for a new address) does not fit what is left of the daily cap. Tell the user; do not buy in parts to get under it.
- Not enough balance: `get_deposit_address` and ask the user to top up; never buy on credit.
- A timeout or a lost answer: retry `buy_energy` with the same `idempotency_key` — it never charges twice.
