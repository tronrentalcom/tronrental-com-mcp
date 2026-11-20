import assert from "node:assert/strict";
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolListChangedNotificationSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Bridge, createServer } from "./bridge.js";
import { HEADLESS_TOOLS } from "./headless.js";

const GOOD_KEY = "tr_good_key";
const NEW_KEY = "tr_new_key";
const API_URL = "http://rest.test/v1";

const REMOTE_TOOLS: Tool[] = [
  {
    name: "quote_energy",
    description: "Quote energy at the account's price. Read-only.",
    inputSchema: { type: "object", properties: { volume: { type: "integer" } }, required: ["volume"] },
    annotations: { title: "Quote energy", readOnlyHint: true },
  },
  {
    name: "buy_energy",
    description: "Buy energy. Spends the account balance.",
    inputSchema: { type: "object", properties: { target_address: { type: "string" }, volume: { type: "integer" } } },
    annotations: { title: "Buy energy", readOnlyHint: false, destructiveHint: false },
  },
];

/** The remote MCP server: stateless streamable HTTP, an API key in X-API-Key. */
let http: HttpServer;
let mcpUrl: string;
const seen: { headers: IncomingMessage["headers"]; calls: unknown[] } = { headers: {}, calls: [] };

before(async () => {
  http = createHttpServer(async (req, res) => {
    const key = req.headers["x-api-key"];
    if (key !== GOOD_KEY && key !== NEW_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" }).end('{"error":{"code":"INVALID_TOKEN"}}');
      return;
    }
    seen.headers = req.headers;
    const server = new Server({ name: "remote", version: "1" }, { capabilities: { tools: {} }, instructions: "remote instructions" });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: REMOTE_TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      seen.calls.push(r.params);
      return { content: [{ type: "text", text: '{"order_id":7}' }], structuredContent: { order_id: 7 } };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  mcpUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});

after(() => new Promise<void>((resolve) => http.close(() => resolve())));

type Rest = (path: string, init: RequestInit) => { status: number; body: unknown };

/** The REST side of the sign-up is answered here; everything else goes to the network (the fake remote). */
function fetchWith(rest: Rest, log: { path: string; init: RequestInit }[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(API_URL)) {
      const path = url.slice(API_URL.length);
      log.push({ path, init: init ?? {} });
      const { status, body } = rest(path, init ?? {});
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }
    return fetch(input, init);
  }) as typeof fetch;
}

async function connect(bridge: Bridge) {
  const server = await createServer(bridge);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server };
}

const text = (result: unknown) => ((result as { content: { text: string }[] }).content)[0].text;

describe("with an API key", () => {
  test("tools/list is the server's catalog, as the server sent it", async () => {
    const bridge = new Bridge({ apiKey: GOOD_KEY, mcpUrl, apiUrl: API_URL });
    const { client } = await connect(bridge);
    assert.deepEqual((await client.listTools()).tools, REMOTE_TOOLS);
    assert.equal(client.getInstructions(), "remote instructions");
    await bridge.close();
  });

  test("tools/call goes to the server with the key and the team account", async () => {
    seen.calls = [];
    const bridge = new Bridge({ apiKey: GOOD_KEY, mcpUrl, apiUrl: API_URL, accountId: "42" });
    const { client } = await connect(bridge);
    const args = { target_address: "TXYZ", volume: 65000, idempotency_key: "k-1" };
    const result = await client.callTool({ name: "buy_energy", arguments: args });
    assert.deepEqual(result.structuredContent, { order_id: 7 });
    assert.deepEqual(seen.calls, [{ name: "buy_energy", arguments: args }]);
    assert.equal(seen.headers["x-api-key"], GOOD_KEY);
    assert.equal(seen.headers["x-account-id"], "42");
    assert.match(String(seen.headers["user-agent"]), /^tronrental-mcp\/2\./);
    await bridge.close();
  });

  test("a refused key is a tool error that says what to fix", async () => {
    const bridge = new Bridge({ apiKey: "tr_revoked", mcpUrl, apiUrl: API_URL });
    const { client } = await connect(bridge);
    const result = await client.callTool({ name: "get_balance", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(text(result), /refused the API key \(HTTP 401\).*TRONRENTAL_API_KEY/);
    await bridge.close();
  });
});

describe("without an API key", () => {
  test("only the sign-up tools, and no catalog tool answers", async () => {
    const bridge = new Bridge({ mcpUrl, apiUrl: API_URL, fetchFn: fetchWith(() => ({ status: 500, body: {} })) });
    const { client } = await connect(bridge);
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.deepEqual(names, HEADLESS_TOOLS.map((t) => t.name));
    assert.ok(!names.includes("buy_energy"));
    const result = await client.callTool({ name: "buy_energy", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(text(result), /Unknown tool/);
  });

  test("register then verify_email_code sends the remembered password and keeps the token out of the answer", async () => {
    const log: { path: string; init: RequestInit }[] = [];
    const rest: Rest = (path) =>
      path === "/auth/register"
        ? { status: 200, body: { requires_email_code: true } }
        : { status: 200, body: { access_token: "jwt-secret", is_new: true } };
    const bridge = new Bridge({ mcpUrl, apiUrl: API_URL, fetchFn: fetchWith(rest, log) });
    const { client } = await connect(bridge);
    const reg = await client.callTool({ name: "register", arguments: { email: "A@x.io", password: "Passw0rd!" } });
    assert.match(text(reg), /email_code_sent/);
    const ver = await client.callTool({ name: "verify_email_code", arguments: { email: "a@x.io", code: "123456" } });
    assert.match(text(ver), /registered/);
    assert.doesNotMatch(text(ver), /jwt-secret/);
    assert.deepEqual(JSON.parse(String(log[1].init.body)), { email: "a@x.io", code: "123456", password: "Passw0rd!" });
  });

  test("below the top-up bar create_api_key says how much is missing and the tools stay", async () => {
    const rest: Rest = (path) =>
      path === "/auth/login"
        ? { status: 200, body: { access_token: "jwt" } }
        : {
            status: 403,
            body: { detail: { error: { code: "API_KEY_DEPOSIT_REQUIRED", message: "Top up", required_trx: "100", missing_trx: "60" } } },
          };
    const bridge = new Bridge({ mcpUrl, apiUrl: API_URL, fetchFn: fetchWith(rest) });
    const { client } = await connect(bridge);
    await client.callTool({ name: "login", arguments: { email: "a@x.io", password: "p" } });
    const result = await client.callTool({ name: "create_api_key", arguments: {} });
    assert.equal(result.isError, true);
    const body = JSON.parse(text(result));
    assert.equal(body.status, "deposit_required");
    assert.equal(body.missing_trx, "60");
    assert.ok((await client.listTools()).tools.some((t) => t.name === "create_api_key"));
  });

  test("a new key switches this session to the server's catalog and tells the client", async () => {
    const log: { path: string; init: RequestInit }[] = [];
    const rest: Rest = (path) =>
      path === "/auth/login" ? { status: 200, body: { access_token: "jwt" } } : { status: 200, body: { id: 9, key: NEW_KEY } };
    const bridge = new Bridge({ mcpUrl, apiUrl: API_URL, fetchFn: fetchWith(rest, log) });
    const { client } = await connect(bridge);
    let changed = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      changed += 1;
    });
    await client.callTool({ name: "login", arguments: { email: "a@x.io", password: "p" } });
    const created = await client.callTool({ name: "create_api_key", arguments: { name: "agent" } });
    assert.equal(JSON.parse(text(created)).api_key, NEW_KEY);
    assert.equal((log[1].init.headers as Record<string, string>).Authorization, "Bearer jwt");
    await new Promise((r) => setImmediate(r));
    assert.equal(changed, 1);
    assert.deepEqual((await client.listTools()).tools, REMOTE_TOOLS);
    assert.equal(seen.headers["x-api-key"], NEW_KEY);
    await bridge.close();
  });

  test("account tools before sign-in say to sign in, without a request", async () => {
    const log: { path: string; init: RequestInit }[] = [];
    const bridge = new Bridge({ mcpUrl, apiUrl: API_URL, fetchFn: fetchWith(() => ({ status: 200, body: {} }), log) });
    const { client } = await connect(bridge);
    const result = await client.callTool({ name: "get_balance", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(text(result), /NOT_SIGNED_IN/);
    assert.equal(log.length, 0);
  });
});
