#!/usr/bin/env node
/**
 * @tronrental-com/mcp-server 2.x — stdio bridge to the TronRental remote MCP server,
 * for MCP clients that speak only stdio. Clients with remote MCP support connect to
 * https://mcp.tronrental.com/mcp directly (OAuth sign-in, no key to copy).
 *
 * Environment:
 *   TRONRENTAL_API_KEY     API key (tronrental.com → API). Without it: headless sign-up tools.
 *   TRONRENTAL_ACCOUNT_ID  optional: a team account the key may act on.
 *   TRONRENTAL_MCP_URL     optional: the remote MCP endpoint (default https://mcp.tronrental.com/mcp).
 *   TRONRENTAL_API_URL     optional: the REST base of the sign-up tools (default https://api.tronrental.com/v1).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Bridge, createServer } from "./bridge.js";

const bridge = new Bridge({
  apiKey: process.env.TRONRENTAL_API_KEY?.trim(),
  accountId: process.env.TRONRENTAL_ACCOUNT_ID?.trim() || undefined,
  mcpUrl: process.env.TRONRENTAL_MCP_URL?.trim() || undefined,
  apiUrl: process.env.TRONRENTAL_API_URL?.trim() || undefined,
});

const server = await createServer(bridge);
await server.connect(new StdioServerTransport());

const shutdown = async () => {
  await bridge.close();
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
