---
name: energy-resale-setup
description: Set up Energy Resale: a payment address where anyone who sends TRX receives energy at the user's price, and the margin goes to the user. Use when the user wants to sell TRON energy to their own customers.
---

# Energy Resale setup

## Before you start

- The TronRental MCP server must be connected (`get_balance` answers). If it is not, follow https://tronrental.com/skill.md.
- A tool missing from the list means the connection does not have that permission: ask the user to reconnect and allow it. Until the account's top-ups total 100 TRX, a connection can only read (balance, deposit address, deposits): the user tops up first, then reconnects. Spending that runs by itself needs its own permission; if the consent screen does not offer it, the user sets it up in the dashboard.
- Tell the user what it will cost before any call that spends. If the tool takes an `idempotency_key`, pass a new UUID and reuse the same key if you retry that action. A tool without it is not safe to retry blindly: read the state first.
- Calls that spend right away count against the connection's daily cap (100 TRX a day unless the user changed it). `409 AGENT_SPEND_CAP` means the cap has no room for this call: tell the user, who can change the cap in Dashboard → API → Connected apps. Never split a purchase to fit under it.

Energy Resale serves every buyer on its own, outside the connection's daily cap. With a generated address the energy is paid from what buyers send; with the user's own address the TRX arrives there and the energy is charged to the balance. Set it up only when the user asks for it.

## Steps

1. Agree on the price per energy unit, in SUN (the service accepts a set range).
2. On the user's yes: `generate_resale_address` for a new payment address, or `activate_resale` for an address the user already has (it also takes a minimum payment, `min_trx`; for a generated address set it afterwards with `update_resale`).
3. Give the user the payment address to publish to their buyers.
4. `get_resale_balance` and `get_resale_logs` show sales; for a generated address `collect_resale_profit` moves the profit (received minus cost) to the balance; with the user's own address the TRX is already there.
5. `update_resale` changes the price and the minimum; `deactivate_resale` stops it.

