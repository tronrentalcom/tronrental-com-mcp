# tronrental — TronRental from the command line

Rent TRON energy and bandwidth, check balances and orders, and withdraw from [TronRental.com](https://tronrental.com) in a terminal, a script or CI.

```bash
npm install -g @tronrental-com/cli     # Node 20+
tronrental login
tronrental balance
```

## Sign in

**In the browser** — for your own machine:

```bash
tronrental login        # opens the TronRental sign-in page; you choose what the CLI may do
tronrental status       # which server and credentials are in use
tronrental logout       # revokes this machine's tokens and forgets them
```

The CLI appears as «TronRental CLI» in your account's connected apps; removing it there cuts every machine signed in with it. The tokens are kept in the OS keychain: macOS Keychain, Windows Credential Manager or the Linux Secret Service. On a machine without a keychain they go to `~/.config/tronrental/credentials.json`, readable only by you.

**With an API key** — for servers and CI. Create one at tronrental.com → API.

```bash
export TRONRENTAL_API_KEY=your_key      # or --api-key your_key
tronrental balance
```

An API key wins over a browser sign-in when both are present.

## Commands

The commands are the TronRental MCP server's tools, read from the server on every run. `tronrental tools` lists the ones your credentials allow. `tronrental <command> --help` shows a command's flags. A tool such as `buy_energy` is the command `buy-energy`, and its argument `target_address` is the flag `--target-address`.

Short names for the common ones:

| Short | Command |
|---|---|
| `balance` | `get-balance` |
| `prices` | `get-energy-prices` |
| `quote` | `quote-energy` (duration `1h` unless given) |
| `buy` | `buy-energy` (duration `1h` unless given) |
| `orders` | `list-orders` |
| `order <id>` | `get-order` |
| `deposit` | `get-deposit-address` |

`--address`, `--amount` and `--max-price` work as the friendly names of the address, amount and price flags:

```bash
tronrental quote --amount 65000
tronrental buy --address TXYZ... --amount 65000 --max-price 3.1
tronrental order 240294
```

### Flags

| Flag | |
|---|---|
| `--json` | machine-readable output on stdout; an error is `{"error": {...}}` and exit code 1 |
| `--dry-run` | show what a purchase would cost (its quote) and buy nothing |
| `--idempotency-key <key>` | a spending command makes a key and prints it; pass the same key to retry safely after a timeout |
| `--input <json>` | the arguments as JSON; flags override it |
| `--account <id>` | act on a team account your credentials may act on (`TRONRENTAL_ACCOUNT_ID`) |
| `--server <url>` | another MCP endpoint (`TRONRENTAL_MCP_URL`) |
| `--yes` | withdraw without the confirmation question — for scripts only |

Exit codes: `0` — done; `1` — the server refused or failed; `2` — the command line is wrong.

## Withdrawals

Withdrawals need an **API key with the `withdraw` scope**. A browser sign-in never gets it. The key's rules apply as on the API: the IP allowlist and 2FA (`--totp-code`).

```bash
tronrental withdraw --currency TRX --amount 10 --address TXYZ...
```

Before sending, the CLI prints the amount, the fee (`get_withdrawal_fee`) and the full address, then asks for confirmation. Without a terminal it refuses unless `--yes` is given. `--dry-run` prints the same and sends nothing.

## Links

- [TronRental.com](https://tronrental.com) · [API documentation](https://docs.tronrental.com) · [Source](https://github.com/tronrentalcom/tronrental-com-mcp)

MIT
