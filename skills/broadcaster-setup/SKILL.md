---
name: broadcaster-setup
description: Set up a TronRental broadcaster node: a TRON node URL that delegates energy to each transaction sent through it, charged to the balance. Use when the user's wallet or backend sends transactions through its own node URL and wants energy without buying it per transfer.
---

# Broadcaster setup

## Before you start

- The TronRental MCP server must be connected (`get_balance` answers). If it is not, follow https://tronrental.com/skill.md.
- A tool missing from the list means the connection does not have that permission: ask the user to reconnect and allow it. Until the account's top-ups total 100 TRX, a connection can only read (balance, deposit address, deposits): the user tops up first, then reconnects. Spending that runs by itself needs its own permission; if the consent screen does not offer it, the user sets it up in the dashboard.
- Tell the user what it will cost before any call that spends. If the tool takes an `idempotency_key`, pass a new UUID and reuse the same key if you retry that action. A tool without it is not safe to retry blindly: read the state first.
- Calls that spend right away count against the connection's daily cap (100 TRX a day unless the user changed it). `409 AGENT_SPEND_CAP` means the cap has no room for this call: tell the user, who can change the cap in Dashboard → API → Connected apps. Never split a purchase to fit under it.

A broadcaster node URL spends the user's balance for every transaction sent through it, outside the connection's daily cap. Treat the URL as a secret.

## Steps

1. `get_broadcaster_quota`: how many nodes the account may create.
2. On the user's yes: `create_broadcast_slug` (optionally a label; bandwidth delegation is on by default).
3. **The answer contains the node URL.** Give it to the user once, to put in their wallet or backend in place of the TRON node URL; never repeat it later, and never write it to files or logs. Lists and updates show it masked. If the answer was lost, retry `create_broadcast_slug` with the same `idempotency_key`: it returns the same node and its URL instead of creating a second one.
4. Settings, changed with `update_broadcast_slug` (tell the user the defaults):
   - `block_on_insufficient` (on by default) — refuse a transaction when the balance cannot pay for its energy, instead of sending it to burn TRX;
   - `calls_enabled` (on by default) — the node also pays for swaps and other contract calls; turn it off to limit it to token transfers;
   - `revert_protection` (off by default) — refuse a call that the check shows would fail (without it such a call goes out without energy, and the sender pays for the failure);
   - `is_active` — pause the node.
5. `list_broadcast_events` shows what was sent and charged.

To stop it for good: `delete_broadcast_slug`. A leaked URL — delete it and create a new one.
