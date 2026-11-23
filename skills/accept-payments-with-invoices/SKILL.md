---
name: accept-payments-with-invoices
description: Create a TronRental invoice so that someone else pays for energy or bandwidth for an address. Use when the user wants a customer or a teammate to pay, or wants energy without spending their own balance.
---

# Accept payments with invoices

## Before you start

- The TronRental MCP server must be connected (`get_balance` answers). If it is not, follow https://tronrental.com/skill.md.
- A tool missing from the list means the connection does not have that permission: ask the user to reconnect and allow it. Until the account's top-ups total 100 TRX, a connection can only read (balance, deposit address, deposits): the user tops up first, then reconnects. Spending that runs by itself needs its own permission; if the consent screen does not offer it, the user sets it up in the dashboard.
- Tell the user what it will cost before any call that spends. If the tool takes an `idempotency_key`, pass a new UUID and reuse the same key if you retry that action. A tool without it is not safe to retry blindly: read the state first.
- Calls that spend right away count against the connection's daily cap (100 TRX a day unless the user changed it). `409 AGENT_SPEND_CAP` means the cap has no room for this call: tell the user, who can change the cap in Dashboard → API → Connected apps. Never split a purchase to fit under it.

An invoice is paid by whoever sends the amount to its address; the energy (or bandwidth) is delivered to the target address after payment. Creating an invoice spends nothing.

## Steps

1. Agree on the target address and what it gets: a number of USDT transfers (`transfer_count`) or an energy amount (`energy_amount`), optionally with bandwidth (`bandwidth_amount`).
2. `create_invoice`. Give the payer the invoice's payment address, the exact amount and the deadline.
3. `send_invoice_email` sends it to the payer's email, if the user gives one.
4. `get_invoice` shows whether it is paid and delivered; `list_my_invoices` lists them.

Ask the payer to send the exact amount, in one transfer, before the invoice expires.
