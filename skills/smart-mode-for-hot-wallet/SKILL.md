---
name: smart-mode-for-hot-wallet
description: Turn on Smart Mode for a hot wallet that sends many USDT transfers: energy is delegated for every outgoing transfer automatically, for a daily fee plus a fee per transfer. Use when the user runs an exchange, payment or payout wallet on TRON.
---

# Smart Mode for a hot wallet

## Before you start

- The TronRental MCP server must be connected (`get_balance` answers). If it is not, follow https://tronrental.com/skill.md.
- A tool missing from the list means the connection does not have that permission: ask the user to reconnect and allow it. Until the account's top-ups total 100 TRX, a connection can only read (balance, deposit address, deposits): the user tops up first, then reconnects. Spending that runs by itself needs its own permission; if the consent screen does not offer it, the user sets it up in the dashboard.
- Tell the user what it will cost before any call that spends. If the tool takes an `idempotency_key`, pass a new UUID and reuse the same key if you retry that action. A tool without it is not safe to retry blindly: read the state first.
- Calls that spend right away count against the connection's daily cap (100 TRX a day unless the user changed it). `409 AGENT_SPEND_CAP` means the cap has no room for this call: tell the user, who can change the cap in Dashboard → API → Connected apps. Never split a purchase to fit under it.

Turning Smart Mode on charges the first day's fees at once, and they count against the connection's daily cap. After that it charges the balance on its own — every day and for every transfer — outside the cap. Turn it on only when the user asks for it.

## Steps

1. `get_smart_mode_fees`: show the user all three fees — the daily subscription (`subscription_fee_trx`), the fee per transfer (`transfer_fee_trx`) and the daily bandwidth guarantee (`bw_fee_trx`). The daily fees are charged on days without transfers too.
2. On the user's yes: `activate_smart_mode` for the wallet address. The bandwidth guarantee (`bw_guarantee`) is on by default and adds its daily fee; `stop_after_transfer` pauses it after the next transfer.
3. `list_smart_mode` / `get_smart_mode` show the state; `list_smart_mode_events` — what was delegated and charged.
4. Tell the user how to stop it: `deactivate_smart_mode`, or `pause_smart_mode`. `pause_smart_mode` flips the state (pause ↔ resume) and has no `idempotency_key`: read `get_smart_mode` before and after, and never repeat it after a timeout without reading the state.

Keep the balance topped up: Smart Mode delegates only while the balance pays for it.
