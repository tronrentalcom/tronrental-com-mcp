---
name: transfer-packages
description: Buy a prepaid package of USDT transfers for a TRON address: a number of transfers paid once, which also uses up one transfer per day as its subscription. Use when the user wants a predictable price for a known number of transfers.
---

# Transfer packages

## Before you start

- The TronRental MCP server must be connected (`get_balance` answers). If it is not, follow https://tronrental.com/skill.md.
- A tool missing from the list means the connection does not have that permission: ask the user to reconnect and allow it. Until the account's top-ups total 100 TRX, a connection can only read (balance, deposit address, deposits): the user tops up first, then reconnects. Spending that runs by itself needs its own permission; if the consent screen does not offer it, the user sets it up in the dashboard.
- Tell the user what it will cost before any call that spends. If the tool takes an `idempotency_key`, pass a new UUID and reuse the same key if you retry that action. A tool without it is not safe to retry blindly: read the state first.
- Calls that spend right away count against the connection's daily cap (100 TRX a day unless the user changed it). `409 AGENT_SPEND_CAP` means the cap has no room for this call: tell the user, who can change the cap in Dashboard → API → Connected apps. Never split a purchase to fit under it.

## Steps

1. `list_package_tiers`: show the user the sizes and prices. Tell them a package also uses up one transfer each day it is active, so idle days reduce what is left.
2. `check_package` for the address: it may already have a package.
3. On the user's yes: `buy_package` for the address and size (from the balance).
   - Paying from outside, without balance: `create_package_invoice` gives an address and an amount to pay.
4. `list_my_packages` shows how many transfers are left.

`cancel_package` cancels a package that is not paid yet.
