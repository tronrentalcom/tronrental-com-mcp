# TronRental MCP Server

MCP (Model Context Protocol) server for [TronRental.com](https://tronrental.com) — buy TRON energy to reduce USDT transfer fees by up to 80%.

## What it does

Without energy, each USDT (TRC-20) transfer costs ~6.4 TRX in burned fees.
With TronRental energy, the same transfer costs ~1.8 TRX — **saving 72%**.

This MCP server lets AI agents (Claude Code, Cursor, Windsurf) interact with the TronRental API to register, fund an account, and purchase energy — all from a single prompt.

Registering a new account needs the user's real email: TronRental mails a 6-digit code there, and the account is created only after the agent passes that code to `verify_email_code`. The agent asks the user for the code — it is the only manual step.

## Quick Start

### Claude Code

```bash
claude mcp add tronrental -- npx -y @tronrental-com/mcp-server
```

### With API key (skip registration)

```bash
claude mcp add tronrental -e TRONRENTAL_API_KEY=your_key -- npx -y @tronrental-com/mcp-server
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tronrental": {
      "command": "npx",
      "args": ["-y", "@tronrental-com/mcp-server"],
      "env": {
        "TRONRENTAL_API_KEY": "your_key_here"
      }
    }
  }
}
```

## Tools

| Tool | Description | Auth |
|------|-------------|------|
| `get_prices` | Current energy & bandwidth prices | No |
| `calculate_savings` | Savings calculator (burn vs rental) | No |
| `register` | Start registration — mails a 6-digit code to the user's email | No |
| `verify_email_code` | Confirm the code and create the account | No |
| `resend_email_code` | Mail a new code (expired or not received) | No |
| `login` | Log in to existing account | No |
| `create_api_key` | Generate API key | Token |
| `get_deposit_address` | Get TRX deposit address | API key |
| `get_balance` | Check account balance | API key |
| `buy_energy` | Purchase energy for a TRON address | API key |
| `get_order` | Check order status | API key |
| `regenerate_deposit_address` | Generate new deposit address | API key |

## Typical Flow

1. `get_prices` — check current pricing
2. `calculate_savings` — see how much you save
3. `register` — the user's real email + password; a 6-digit code goes to that inbox
4. The user reads the code from the email and gives it to the agent
5. `verify_email_code` — creates the account and signs in
6. `create_api_key` — get API key
7. `get_deposit_address` — get address to fund account
8. Send TRX to the deposit address
9. `get_balance` — verify deposit arrived
10. `buy_energy` — purchase energy for target address
11. `get_order` — confirm delegation

## Energy Amounts

| Scenario | Energy Needed |
|----------|--------------|
| Recipient **has** USDT | 65,000 |
| Recipient **has no** USDT | 131,000 |

Minimum: 1. Maximum: 5,000,000. Duration: 1 hour. Orders under 32,000 are served from TronRental's own pool; `POOL_EXHAUSTED` means nothing was charged.

## Links

- [TronRental.com](https://tronrental.com)
- [API Documentation](https://docs.tronrental.com)
- [Dashboard](https://tronrental.com/dashboard)

## License

MIT
