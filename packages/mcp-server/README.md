# TronRental MCP bridge

A stdio [MCP](https://modelcontextprotocol.io) server for agents whose client speaks only stdio. It forwards every call to the TronRental remote MCP server, `https://mcp.tronrental.com/mcp`, and takes its tool catalog from there.

**If your client supports remote MCP** (Claude, ChatGPT, Claude Code, Codex, Cursor), connect it to `https://mcp.tronrental.com/mcp` instead. You sign in with TronRental in the browser and there is no key to copy.

## Set up

With an API key (tronrental.com → API):

```bash
claude mcp add tronrental -e TRONRENTAL_API_KEY=your_key -- npx -y @tronrental-com/mcp-server@2.0.0
```

Claude Desktop, Cursor and other clients — the same command in their MCP config:

```json
{
  "mcpServers": {
    "tronrental": {
      "command": "npx",
      "args": ["-y", "@tronrental-com/mcp-server@2.0.0"],
      "env": { "TRONRENTAL_API_KEY": "your_key" }
    }
  }
}
```

| Variable | |
|---|---|
| `TRONRENTAL_API_KEY` | the API key; its scopes decide which tools the agent sees |
| `TRONRENTAL_ACCOUNT_ID` | optional: a team account the key may act on |
| `TRONRENTAL_MCP_URL` | optional: another MCP endpoint |
| `TRONRENTAL_API_URL` | optional: the REST base of the sign-up tools below |

## Without a key: sign-up

Without `TRONRENTAL_API_KEY` the agent can create an account for the user. It sees only these tools:

1. `get_energy_prices` — current prices.
2. `register` — the user's real email and a password. TronRental mails a 6-digit code to that address.
3. `verify_email_code` — the code from the user. This creates the account. `login` and `resend_email_code` are there too.
4. `get_deposit_address`, `get_balance` — the user tops up the balance.
5. `create_api_key` — issued once the account's top-ups reach 100 TRX; below that it says how much is missing.

Once the key is issued, the session switches to the full tool set and tells the client the tool list changed. The user saves the key as `TRONRENTAL_API_KEY` for next time.

## Upgrading from 1.x

1.x defined 12 tools of its own. 2.0 serves the server's catalog: quotes, energy and bandwidth, orders, subscriptions and more, depending on the key's scopes.
- `get_prices` is now `get_energy_prices`.
- `calculate_savings` is now `analyze_savings` or `estimate_energy`.
- `buy_energy` takes `max_price_trx` from `quote_energy` and an `idempotency_key`.

## Links

- [TronRental.com](https://tronrental.com) · [API documentation](https://docs.tronrental.com) · [Source](https://github.com/tronrentalcom/tronrental-com-mcp)

MIT
