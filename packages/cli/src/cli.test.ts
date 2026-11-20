import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { parseArgv, toolArguments } from "./args.js";
import { main, type Io } from "./cli.js";
import { CLIENT_METADATA_URL, StoredOAuthProvider } from "./oauth.js";
import type { Session, SessionStore } from "./store.js";
import { VERSION } from "./version.js";

const KEY = "tr_key";
const WITHDRAW_KEY = "tr_withdraw_key";
const ADDRESS = "TXYZabcdefghijklmnopqrstuvwxyz1234";

const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: "object" as const, properties, required });
const idem = { idempotency_key: { type: "string", maxLength: 64 } };

const TOOLS: Tool[] = [
  { name: "get_balance", inputSchema: obj({}), annotations: { title: "Get the account balance", readOnlyHint: true } },
  { name: "get_order", inputSchema: obj({ order_id: { type: "integer" } }, ["order_id"]), annotations: { readOnlyHint: true } },
  { name: "quote_energy", inputSchema: obj({ volume: { type: "integer" }, duration: { type: "string", default: "1h" } }, ["volume"]) },
  {
    name: "buy_energy",
    inputSchema: obj(
      {
        target_address: { type: "string" },
        volume: { type: "integer" },
        duration: { type: "string" },
        max_price_trx: { anyOf: [{ type: "number", exclusiveMinimum: 0 }, { type: "string" }, { type: "null" }] },
        ...idem,
      },
      ["target_address", "volume", "duration"],
    ),
  },
];
const WITHDRAW_TOOLS: Tool[] = [
  { name: "get_withdrawal_fee", inputSchema: obj({ address: { type: "string" } }) },
  {
    name: "withdraw",
    inputSchema: obj({ to_address: { type: "string" }, amount_trx: { type: "number" }, currency: { type: "string" }, ...idem }, ["to_address", "amount_trx"]),
  },
];

let http: HttpServer;
let base: string;
let mcpUrl: string;
let calls: { name: string; arguments: Record<string, unknown> }[] = [];
let lastHeaders: IncomingMessage["headers"] = {};
const oauth = { challenge: "", verifierOk: false, clientId: "", revoked: [] as string[], refreshed: [] as string[], scope: "", dropIss: false };

async function body(req: IncomingMessage): Promise<string> {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data;
}

before(async () => {
  http = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
      res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(data));
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      return json(200, { resource: mcpUrl, authorization_servers: [base], scopes_supported: ["view", "buy_energy"] });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        revocation_endpoint: `${base}/oauth/revoke`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (url.pathname === "/oauth/authorize") {
      oauth.challenge = url.searchParams.get("code_challenge") ?? "";
      oauth.clientId = url.searchParams.get("client_id") ?? "";
      oauth.scope = url.searchParams.get("scope") ?? "";
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", "the-code");
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      if (!oauth.dropIss) back.searchParams.set("iss", base);
      return res.writeHead(302, { Location: back.href }).end();
    }
    if (url.pathname === "/oauth/token") {
      const form = new URLSearchParams(await body(req));
      if (form.get("grant_type") === "refresh_token") {
        oauth.refreshed.push(form.get("refresh_token") ?? "");
        return json(200, { access_token: "oauth-access", refresh_token: "oauth-refresh-2", token_type: "Bearer", expires_in: 3600 });
      }
      const digest = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      oauth.verifierOk = form.get("code") === "the-code" && digest === oauth.challenge && form.get("client_id") === CLIENT_METADATA_URL;
      return json(200, { access_token: "oauth-access", refresh_token: "oauth-refresh", token_type: "Bearer", expires_in: 3600 });
    }
    if (url.pathname === "/oauth/revoke") {
      const token = new URLSearchParams(await body(req)).get("token") ?? "";
      oauth.revoked.push(token);
      return token === "revoke-fails" ? json(503, {}) : json(200, {});
    }
    // The MCP endpoint.
    const key = req.headers["x-api-key"];
    const bearer = req.headers.authorization === "Bearer oauth-access";
    if (key !== KEY && key !== WITHDRAW_KEY && !bearer) {
      return json(401, { error: "invalid_token" }, { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
    }
    lastHeaders = req.headers;
    const tools = key === WITHDRAW_KEY ? [...TOOLS, ...WITHDRAW_TOOLS] : TOOLS;
    const server = new Server({ name: "fake", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      const args = (r.params.arguments ?? {}) as Record<string, unknown>;
      calls.push({ name: r.params.name, arguments: args });
      const answers: Record<string, unknown> = {
        get_balance: { balance_trx: "12.5" },
        quote_energy: { volume: args.volume, total_trx: "3.05" },
        buy_energy: { order_id: 240294, status: "filled" },
        get_order: { order_id: args.order_id, status: "filled" },
        get_withdrawal_fee: { fee_trx: "1", free_available: false },
        withdraw: { id: 5, status: "pending" },
      };
      if (r.params.name === "buy_energy" && args.max_price_trx === 0.01) {
        const error = { code: "PRICE_CHANGED", message: "The price is above max_price_trx", status: 409 };
        return { content: [{ type: "text", text: JSON.stringify({ error }) }], structuredContent: { error }, isError: true };
      }
      const data = answers[r.params.name];
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  mcpUrl = `${base}/mcp`;
});

after(() => new Promise<void>((resolve) => http.close(() => resolve())));

beforeEach(() => {
  calls = [];
});

class MemoryStore implements SessionStore {
  readonly kind = "test store";
  sessions = new Map<string, Session>();
  async load(server: string) {
    return structuredClone(this.sessions.get(server) ?? {});
  }
  async save(server: string, session: Session) {
    this.sessions.set(server, structuredClone(session));
  }
  async remove(server: string) {
    this.sessions.delete(server);
  }
}

function io(over: Partial<Io> = {}, store = new MemoryStore()) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const value: Io = {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    interactive: false,
    ask: async (q) => {
      asked.push(q);
      return "n";
    },
    env: {},
    store: async () => store,
    ...over,
  };
  return { io: value, out, err, asked, store };
}

const run = (argv: string[], t: ReturnType<typeof io>) => main([...argv, "--server", mcpUrl], t.io);

describe("flags from the schema", () => {
  const buy = TOOLS.find((t) => t.name === "buy_energy")!;

  test("kebab flags, friendly synonyms and numbers by type", () => {
    const { flags } = parseArgv(["--address", ADDRESS, "--amount", "65000", "--max-price=3.1", "--duration", "1h"]);
    assert.deepEqual(toolArguments(buy, flags), { target_address: ADDRESS, volume: 65000, max_price_trx: 3.1, duration: "1h" });
  });

  test("an integer flag refuses a fraction and an unknown flag names the real ones", () => {
    assert.throws(() => toolArguments(buy, parseArgv(["--volume", "6.5"]).flags), /expected integer/);
    assert.throws(() => toolArguments(buy, parseArgv(["--colour", "red"]).flags), /Unknown flag --colour.*--target-address/);
  });

  test("an array flag takes commas, repeats or JSON", () => {
    const many = { name: "t", inputSchema: obj({ addrs: { type: "array", items: { type: "string" } }, ids: { type: "array", items: { type: "integer" } } }) } as Tool;
    assert.deepEqual(toolArguments(many, parseArgv(["--addrs", "A,B", "--addrs", "C", "--ids", "1,2"]).flags), { addrs: ["A", "B", "C"], ids: [1, 2] });
    assert.deepEqual(toolArguments(many, parseArgv(["--ids", "[3,4]"]).flags), { ids: [3, 4] });
  });

  test("a friendly flag and the real one for the same argument is refused, not one silently winning", () => {
    assert.throws(() => toolArguments(buy, parseArgv(["--amount", "65000", "--volume", "650000"]).flags), /--volume is given more than once/);
  });

  test("global flags are not tool arguments", () => {
    const parsed = parseArgv(["buy", "--json", "--dry-run", "--api-key", "k", "--volume", "1"]);
    assert.equal(parsed.globals.json && parsed.globals.dryRun, true);
    assert.equal(parsed.globals.apiKey, "k");
    assert.deepEqual([...parsed.flags.keys()], ["volume"]);
  });
});

describe("commands from tools/list", () => {
  test("an alias runs its tool and --json prints the structured answer", async () => {
    const t = io({ env: { TRONRENTAL_API_KEY: KEY } });
    assert.equal(await run(["balance", "--json"], t), 0);
    assert.deepEqual(JSON.parse(t.out[0]), { balance_trx: "12.5" });
    assert.equal(lastHeaders["x-api-key"], KEY);
    assert.match(String(lastHeaders["user-agent"]), /^tronrental-cli\//);
  });

  test("one bare value fills the one required argument", async () => {
    const t = io({ env: { TRONRENTAL_API_KEY: KEY } });
    assert.equal(await run(["order", "77"], t), 0);
    assert.deepEqual(calls, [{ name: "get_order", arguments: { order_id: 77 } }]);
  });

  test("--dry-run prices a purchase by its quote and buys nothing", async () => {
    const t = io({ env: { TRONRENTAL_API_KEY: KEY } });
    assert.equal(await run(["buy", "--address", ADDRESS, "--amount", "65000", "--dry-run", "--json"], t), 0);
    assert.deepEqual(calls.map((c) => c.name), ["quote_energy"]);
    assert.deepEqual(calls[0].arguments, { volume: 65000, duration: "1h" });
    const out = JSON.parse(t.out[0]);
    assert.equal(out.would_call, "buy_energy");
    assert.equal(out.quote.total_trx, "3.05");
  });

  test("a purchase gets an idempotency key, printed for a retry, or the one given", async () => {
    const t = io({ env: { TRONRENTAL_API_KEY: KEY } });
    assert.equal(await run(["buy-energy", "--target-address", ADDRESS, "--volume", "65000", "--duration", "1h"], t), 0);
    const made = calls[0].arguments.idempotency_key as string;
    assert.match(made, /^[0-9a-f-]{36}$/);
    assert.ok(t.err.some((line) => line.includes(`--idempotency-key ${made}`)));
    calls = [];
    await run(["buy", "--address", ADDRESS, "--amount", "65000", "--idempotency-key", "retry-1"], t);
    assert.equal(calls[0].arguments.idempotency_key, "retry-1");
  });

  test("a tool error exits 1 with the server's code", async () => {
    const t = io({ env: { TRONRENTAL_API_KEY: KEY } });
    assert.equal(await run(["buy", "--address", ADDRESS, "--amount", "65000", "--max-price", "0.01", "--json"], t), 1);
    assert.equal(JSON.parse(t.out[0]).error.code, "PRICE_CHANGED");
  });

  test("a missing required flag is a usage error before any call", async () => {
    const t = io({ env: { TRONRENTAL_API_KEY: KEY } });
    assert.equal(await run(["buy", "--amount", "65000"], t), 2);
    assert.match(t.err.join("\n"), /Missing --target-address/);
    assert.deepEqual(calls, []);
  });
});

describe("withdraw", () => {
  const withdraw = ["withdraw", "--currency", "TRX", "--amount", "10", "--address", ADDRESS];

  test("not offered to a browser sign-in", async () => {
    const store = new MemoryStore();
    await store.save(mcpUrl, { tokens: { access_token: "oauth-access", token_type: "Bearer" } });
    const t = io({}, store);
    assert.equal(await run(withdraw, t), 1);
    assert.match(t.err.join("\n"), /API key with the withdraw scope/);
    assert.deepEqual(calls, []);
  });

  test("without a terminal and without --yes nothing is sent", async () => {
    const t = io({ env: { TRONRENTAL_API_KEY: WITHDRAW_KEY } });
    assert.equal(await run(withdraw, t), 2);
    assert.deepEqual(calls.map((c) => c.name), ["get_withdrawal_fee"]);
    assert.match(t.err.join("\n"), /amount: {2}10 TRX[\s\S]*fee: {5}1 TRX[\s\S]*to: {6}TXYZabcdefghijklmnopqrstuvwxyz1234/);
  });

  test("a person who does not answer yes sends nothing", async () => {
    const t = io({ env: { TRONRENTAL_API_KEY: WITHDRAW_KEY }, interactive: true });
    assert.equal(await run(withdraw, t), 0);
    assert.equal(t.asked.length, 1);
    assert.deepEqual(calls.map((c) => c.name), ["get_withdrawal_fee"]);
  });

  test("a yes sends it once, with the fee asked for the same address", async () => {
    const t = io({ env: { TRONRENTAL_API_KEY: WITHDRAW_KEY }, interactive: true, ask: async () => "y" });
    assert.equal(await run([...withdraw, "--idempotency-key", "w-1"], t), 0);
    assert.deepEqual(calls, [
      { name: "get_withdrawal_fee", arguments: { address: ADDRESS } },
      { name: "withdraw", arguments: { to_address: ADDRESS, amount_trx: 10, currency: "TRX", idempotency_key: "w-1" } },
    ]);
  });

  test("--yes skips the question but still prints what is sent", async () => {
    const t = io({ env: { TRONRENTAL_API_KEY: WITHDRAW_KEY } });
    assert.equal(await run([...withdraw, "--yes"], t), 0);
    assert.deepEqual(calls.map((c) => c.name), ["get_withdrawal_fee", "withdraw"]);
    assert.match(t.err.join("\n"), new RegExp(ADDRESS));
  });
});

describe("login", () => {
  const openUrl = (store: MemoryStore) => async (url: string) => {
    const resp = await fetch(url, { redirect: "manual" });
    await fetch(resp.headers.get("location")!);
    void store;
  };

  test("signs in with our client document and PKCE, then commands use the tokens", async () => {
    const store = new MemoryStore();
    const t = io({ openUrl: (u) => void openUrl(store)(u) }, store);
    assert.equal(await run(["login"], t), 0, t.err.join("\n"));
    assert.equal(oauth.clientId, CLIENT_METADATA_URL);
    assert.equal(oauth.scope, "view buy_energy");
    assert.equal(oauth.verifierOk, true);
    assert.equal(store.sessions.get(mcpUrl)?.tokens?.refresh_token, "oauth-refresh");
    const after = io({}, store);
    assert.equal(await run(["balance"], after), 0);
    assert.equal(lastHeaders.authorization, "Bearer oauth-access");
  });

  test("logout revokes the refresh token and forgets the session", async () => {
    const store = new MemoryStore();
    await run(["login"], io({ openUrl: (u) => void openUrl(store)(u) }, store));
    assert.equal(await run(["logout"], io({}, store)), 0);
    assert.deepEqual(oauth.revoked.slice(-1), ["oauth-refresh"]);
    assert.equal(store.sessions.has(mcpUrl), false);
  });

  test("logout says so when the server did not confirm the revocation", async () => {
    const store = new MemoryStore();
    await run(["login"], io({ openUrl: (u) => void openUrl(store)(u) }, store));
    const session = await store.load(mcpUrl);
    session.tokens!.refresh_token = "revoke-fails";
    await store.save(mcpUrl, session);
    const t = io({}, store);
    assert.equal(await run(["logout"], t), 1);
    assert.match(t.err.join("\n"), /did not confirm the revocation/);
  });

  test("an API key in the environment wins over a stored sign-in", async () => {
    const store = new MemoryStore();
    await store.save(mcpUrl, { tokens: { access_token: "oauth-access", token_type: "Bearer" } });
    await run(["balance"], io({ env: { TRONRENTAL_API_KEY: KEY } }, store));
    assert.equal(lastHeaders["x-api-key"], KEY);
    assert.equal(lastHeaders.authorization, undefined);
  });

  test("an expired access token is refreshed, not a failure an hour after login", async () => {
    const store = new MemoryStore();
    await store.save(mcpUrl, { tokens: { access_token: "stale", refresh_token: "oauth-refresh", token_type: "Bearer" }, clientInformation: { client_id: CLIENT_METADATA_URL } });
    const t = io({}, store);
    assert.equal(await run(["balance"], t), 0, t.err.join("\n"));
    assert.deepEqual(oauth.refreshed.slice(-1), ["oauth-refresh"]);
    assert.equal(store.sessions.get(mcpUrl)?.tokens?.refresh_token, "oauth-refresh-2");
  });

  test("a stored DCR client keeps working for commands after login --register-client", async () => {
    const store = new MemoryStore();
    await store.save(mcpUrl, { tokens: { access_token: "stale", refresh_token: "oauth-refresh", token_type: "Bearer" }, clientInformation: { client_id: "trc_dcr" } });
    assert.equal(await run(["balance"], io({}, store)), 0);
    assert.equal(store.sessions.get(mcpUrl)?.clientInformation?.client_id, "trc_dcr");
  });

  test("a callback without iss is refused when the server promises it (RFC 9207)", async () => {
    const store = new MemoryStore();
    oauth.dropIss = true;
    try {
      const t = io({ openUrl: (u) => void openUrl(store)(u) }, store);
      assert.equal(await run(["login"], t), 1);
      assert.match(t.err.join("\n"), /iss/);
      assert.equal(store.sessions.get(mcpUrl)?.tokens, undefined);
    } finally {
      oauth.dropIss = false;
    }
  });

  test("login picks its client: a stored DCR one is not reused as the published client", () => {
    const session: Session = { clientInformation: { client_id: "trc_dcr" } };
    assert.equal(new StoredOAuthProvider(new MemoryStore(), mcpUrl, session, { registerClient: false }).clientInformation(), undefined);
    assert.equal(new StoredOAuthProvider(new MemoryStore(), mcpUrl, session, { registerClient: true }).clientInformation()?.client_id, "trc_dcr");
  });
});

test("version.ts matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
});
