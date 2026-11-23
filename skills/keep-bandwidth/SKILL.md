---
name: keep-bandwidth
description: Keep bandwidth on a TRON address so transfers do not burn TRX for it: auto bandwidth that tops the address up after each transfer, or a one-off bandwidth purchase. Use when the user's transfers burn TRX for bandwidth or the free daily bandwidth runs out.
---

# Keep bandwidth on an address

## Before you start

- The TronRental MCP server must be connected (`get_balance` answers). If it is not, follow https://tronrental.com/skill.md.
- A tool missing from the list means the connection does not have that permission: ask the user to reconnect and allow it. Until the account's top-ups total 100 TRX, a connection can only read (balance, deposit address, deposits): the user tops up first, then reconnects. Spending that runs by itself needs its own permission; if the consent screen does not offer it, the user sets it up in the dashboard.
- Tell the user what it will cost before any call that spends. If the tool takes an `idempotency_key`, pass a new UUID and reuse the same key if you retry that action. A tool without it is not safe to retry blindly: read the state first.
- Calls that spend right away count against the connection's daily cap (100 TRX a day unless the user changed it). `409 AGENT_SPEND_CAP` means the cap has no room for this call: tell the user, who can change the cap in Dashboard → API → Connected apps. Never split a purchase to fit under it.

## Choose

- **A one-off transfer:** `quote_bandwidth` → `buy_bandwidth` with `max_price_trx` = the quote's `total_trx`.
- **Regular transfers from the address:** auto bandwidth keeps bandwidth there and renews it after it is used up. It charges the balance on its own, outside the connection's daily cap — set it up only when the user asks for exactly that.

## Auto bandwidth

1. `quote_auto_bw` for the bandwidth volume; show the user both prices it returns — per day (`daily_trx`) and per transfer (`transfer_trx`): auto bandwidth charges both.
2. On the user's yes: `create_auto_bw` (token USDT by default; a custom TRC-20 contract must be added first with `add_auto_bw_contract`).
3. Options to offer: stop after the next transfer (`stop_after_transfer`), pause while the address's free daily bandwidth covers a transfer (`auto_pause` with `threshold`), notify when free bandwidth is back (`notify_free_bw`).
4. Tell the user how to stop it: `delete_auto_bw`, or in the dashboard.

`list_auto_bw` shows what is running.
