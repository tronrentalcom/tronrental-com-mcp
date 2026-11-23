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

## Claude Code plugin

This repository is also a Claude Code plugin marketplace. The `tronrental` plugin connects the remote MCP server and adds task skills: buying energy for a USDT transfer, keeping bandwidth on an address, energy auto-refill, Smart Mode for a hot wallet, transfer packages, invoices, a broadcaster node and Energy Resale.

```bash
claude plugin marketplace add tronrentalcom/tronrental-com-mcp
claude plugin install tronrental@tronrental
```

Then `/mcp` → tronrental → Authenticate, and sign in with TronRental. The plugin's files: [`.claude-plugin/`](.claude-plugin), [`.mcp.json`](.mcp.json), [`skills/`](skills). Tool names in the skills follow the server's catalog: when a tool is renamed there, update the skills too.

## Development

```bash
npm ci
npm run typecheck
npm run build
npm test
```

Node 20 or newer. Every pull request runs the same steps in CI.

## Publishing

A version on npm can never be published again, so publish only from a fresh clone of `main`:

```bash
git clone https://github.com/tronrentalcom/tronrental-com-mcp.git && cd tronrental-com-mcp
# or, in an existing clone: git checkout main && git pull
npm ci
```

Look at each tarball before uploading it:

```bash
npm pack --dry-run --workspace packages/mcp-server
npm pack --dry-run --workspace packages/cli
```

In the output check:

- `name` and `version` — the package and the version you mean to publish (`@tronrental-com/mcp-server` 2.x, `@tronrental-com/cli` 1.x);
- the file list — `README.md`, `package.json` and `dist/*.js` only; the bin is there (`dist/index.js` for the bridge, `dist/main.js` for the CLI); no `src/`, no `*.test.js`, no `.env`;
- `total files` — 6 for the bridge, 9 for the CLI as of 2.0.0 / 1.0.0; a much smaller number means an empty or stale `dist`.

Then publish:

```bash
npm publish --workspace packages/mcp-server --access public
npm publish --workspace packages/cli --access public
```

`npm publish` first runs the guard `scripts/prepublish.mjs` (`prepublishOnly`), and stops before uploading if any check fails:

- the checkout is a clean `main` equal to `origin/main`;
- `dist` is deleted and built again, and the tests pass;
- the built CLI's `--version` and the bridge's `serverInfo.version` equal `version` in package.json, and `server.json` names the same version;
- the tarball holds the bin files and no compiled tests.

After the bridge is on npm, publish `server.json` to the MCP Registry with `mcp-publisher publish`.

## Links

- [TronRental.com](https://tronrental.com)
- [API documentation](https://docs.tronrental.com)
- [Dashboard](https://tronrental.com/dashboard)

## License

MIT
