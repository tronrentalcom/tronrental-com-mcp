---
name: auto-refill
description: Set up automatic energy top-ups for a TRON address: when its energy falls below a threshold, TronRental buys more from the balance. Use when the user sends transfers often from one address and does not want to buy energy before each one.
---

# Automatic energy top-up

## Before you start

- The TronRental MCP server must be connected (`get_balance` answers). If it is not, follow https://tronrental.com/skill.md.
- A tool missing from the list means the connection does not have that permission: ask the user to reconnect and allow it. Until the account's top-ups total 100 TRX, a connection can only read (balance, deposit address, deposits): the user tops up first, then reconnects. Spending that runs by itself needs its own permission; if the consent screen does not offer it, the user sets it up in the dashboard.
- Tell the user what it will cost before any call that spends. If the tool takes an `idempotency_key`, pass a new UUID and reuse the same key if you retry that action. A tool without it is not safe to retry blindly: read the state first.
- Calls that spend right away count against the connection's daily cap (100 TRX a day unless the user changed it). `409 AGENT_SPEND_CAP` means the cap has no room for this call: tell the user, who can change the cap in Dashboard → API → Connected apps. Never split a purchase to fit under it.

Auto-refill charges the balance on its own, every time the address runs low, and is outside the connection's daily cap. It has no daily limit of its own. Set it up only when the user asks for it, and only for the user's own address.

## Steps

1. Agree on the address, the threshold (refill when energy drops below it) and the amount to add each time — e.g. threshold 65,000 and add 65,000 for one USDT transfer at a time.
2. `quote_energy_autorefill` for that amount. Show the user the price of one refill and how often it buys: refills are rented for one hour, so even an address that sends nothing gets a new refill each time the hour runs out — at least ~24 a day, more with transfers. Keep the threshold at or below the amount added, or it buys again within minutes.
3. On the user's yes: `create_energy_autorefill`. The answer says the address's energy now and whether a refill will happen on the next check.
4. Tell the user how to pause or stop it: `update_energy_autorefill` with status `paused`, or `delete_energy_autorefill`.

The same for bandwidth: `quote_bandwidth_autorefill` → `create_bandwidth_autorefill`. `list_energy_autorefill` and `list_bandwidth_autorefill` show the rules.

A rule stops by itself when the balance runs out and resumes after a top-up.
