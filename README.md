# TronRental for agents and the command line

[TronRental.com](https://tronrental.com) rents TRON energy and bandwidth so that USDT (TRC-20) transfers cost a fraction of the TRX they would burn. This repository holds the tools that reach it from outside the website:

| Package | What it is |
|---|---|
| [`@tronrental-com/cli`](packages/cli) | `tronrental` — the command line: sign in, quote, buy, check orders, withdraw |
| [`@tronrental-com/mcp-server`](packages/mcp-server) | stdio MCP bridge for agents whose client speaks only stdio |

Both talk to the TronRental remote MCP server, `https://mcp.tronrental.com/mcp`. Its tool catalog comes from the server on every connection: neither package keeps a copy of it.

## Which one do I need?

- **An agent whose client supports remote MCP** (Claude, ChatGPT, Claude Code, Codex, Cursor): connect it to `https://mcp.tronrental.com/mcp` directly. You sign in with TronRental in the browser and choose what the agent may do; there is no key to copy.

  ```bash
  claude mcp add --transport http tronrental https://mcp.tronrental.com/mcp
  ```

- **A terminal, a script or CI:** the CLI.

  ```bash
  npm install -g @tronrental-com/cli
  tronrental login
  tronrental quote --amount 65000
  ```

- **An agent client that speaks only stdio:** the bridge, with an API key.

  ```bash
  claude mcp add tronrental -e TRONRENTAL_API_KEY=your_key -- npx -y @tronrental-com/mcp-server@2.0.0
  ```

## Development

```bash
npm ci
npm run typecheck
npm run build
npm test
```

Node 20 or newer. Every pull request runs the same steps in CI.

## Links

- [TronRental.com](https://tronrental.com)
- [API documentation](https://docs.tronrental.com)
- [Dashboard](https://tronrental.com/dashboard)

## License

MIT
