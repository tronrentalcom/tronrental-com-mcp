# TronRental MCP Server

MCP (Model Context Protocol) server for [TronRental.com](https://tronrental.com) — buy TRON energy to reduce USDT transfer fees by up to 80%.

## What it does

Without energy, each USDT (TRC-20) transfer costs ~6.4 TRX in burned fees.
With TronRental energy, the same transfer costs ~1.8 TRX — **saving 72%**.

This MCP server lets AI agents (Claude Code, Cursor, Windsurf) interact with the TronRental API to register, fund an account, and purchase energy — all from a single prompt.

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
| `register` | Create a new account | No |
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
3. `register` — create account
4. `create_api_key` — get API key
5. `get_deposit_address` — get address to fund account
6. Send TRX to the deposit address
7. `get_balance` — verify deposit arrived
8. `buy_energy` — purchase energy for target address
9. `get_order` — confirm delegation

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
