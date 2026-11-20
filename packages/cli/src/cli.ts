/**
 * `tronrental`: the TronRental MCP server's tool catalog as commands. The commands
 * are built from `tools/list` on every run — the CLI keeps no copy of the catalog.
 */

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { commandHelp, commandName, missingRequired, parseArgv, toolArguments, type GlobalFlags } from "./args.js";
import { CliError, StoredOAuthProvider, login, logout } from "./oauth.js";
import { errorData, human, resultData } from "./output.js";
import type { SessionStore } from "./store.js";
import { VERSION } from "./version.js";

export const DEFAULT_SERVER = "https://mcp.tronrental.com/mcp";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Whether a person can answer a question on this terminal. */
  interactive: boolean;
  ask: (question: string) => Promise<string>;
  env: Record<string, string | undefined>;
  store: () => Promise<SessionStore>;
  fetchFn?: typeof fetch;
  openUrl?: (url: string) => void;
}

export function processIo(makeStore: () => Promise<SessionStore>): Io {
  let store: Promise<SessionStore> | undefined;
  return {
    stdout: (t) => process.stdout.write(t.endsWith("\n") ? t : t + "\n"),
    stderr: (t) => process.stderr.write(t.endsWith("\n") ? t : t + "\n"),
    interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    env: process.env,
    store: () => (store ??= makeStore()),
  };
}

/** Short names for what people do most. `defaults` fill flags the user did not give. */
export const ALIASES: Record<string, { tool: string; defaults?: Record<string, unknown> }> = {
  balance: { tool: "get_balance" },
  prices: { tool: "get_energy_prices" },
  quote: { tool: "quote_energy", defaults: { duration: "1h" } },
  buy: { tool: "buy_energy", defaults: { duration: "1h" } },
  orders: { tool: "list_orders" },
  order: { tool: "get_order" },
  deposit: { tool: "get_deposit_address" },
};

/** The quote a spending command is priced by in `--dry-run`. */
export const QUOTES: Record<string, string> = {
  buy_energy: "quote_energy",
  buy_bandwidth: "quote_bandwidth",
  create_auto_bw: "quote_auto_bw",
  create_energy_autorefill: "quote_energy_autorefill",
  create_bandwidth_autorefill: "quote_bandwidth_autorefill",
};

const WITHDRAWAL_TOOLS = new Set(["withdraw", "lock_withdrawal_rate", "get_withdrawal_fee", "list_withdrawals", "get_withdrawal"]);

const HELP = `tronrental ${VERSION} — TronRental from the command line: rent TRON energy and bandwidth, check balances and orders.

Usage:
  tronrental login                 sign in in the browser (tokens go to the OS keychain)
  tronrental logout                revoke the sign-in and forget it
  tronrental status                which server and credentials are in use
  tronrental tools                 every command your credentials allow
  tronrental <command> --help      a command's flags
  tronrental <command> [flags]     run it

Common commands:
  tronrental balance
  tronrental prices
  tronrental quote --amount 65000
  tronrental buy --address T... --amount 65000 --max-price 3.1
  tronrental order 12345
  tronrental withdraw --currency TRX --amount 10 --address T...     (API key with the withdraw scope)

Flags:
  --json                  machine-readable output on stdout
  --dry-run               show what would be charged (quote) without doing it
  --idempotency-key <k>   reuse to retry a spending command safely (one is made and printed otherwise)
  --input <json>          arguments as JSON (flags override)
  --yes                   withdraw without the confirmation question (scripts only)
  --api-key <key>         use an API key (or TRONRENTAL_API_KEY) instead of the sign-in
  --account <id>          act on a team account the credentials may act on (TRONRENTAL_ACCOUNT_ID)
  --server <url>          another MCP endpoint (TRONRENTAL_MCP_URL), default ${DEFAULT_SERVER}
  --register-client       login: register this CLI with the server (DCR) instead of the published client document`;

type Credential = { kind: "key"; key: string } | { kind: "oauth"; provider: StoredOAuthProvider };

interface Context {
  globals: GlobalFlags;
  io: Io;
  server: string;
}

async function credential(ctx: Context, required = true): Promise<Credential | null> {
  const key = ctx.globals.apiKey ?? ctx.io.env.TRONRENTAL_API_KEY?.trim();
  if (key) return { kind: "key", key };
  const store = await ctx.io.store();
  const session = await store.load(ctx.server);
  if (session.tokens) return { kind: "oauth", provider: new StoredOAuthProvider(store, ctx.server, session) };
  if (!required) return null;
  throw new CliError("Not signed in: run `tronrental login`, or pass --api-key / set TRONRENTAL_API_KEY.");
}

async function connect(ctx: Context, cred: Credential): Promise<Client> {
  const headers: Record<string, string> = { "User-Agent": `tronrental-cli/${VERSION}` };
  if (cred.kind === "key") headers["X-API-Key"] = cred.key;
  const account = ctx.globals.account ?? ctx.io.env.TRONRENTAL_ACCOUNT_ID?.trim();
  if (account) headers["X-Account-Id"] = account;
  const client = new Client({ name: "tronrental-cli", version: VERSION });
  const transport = new StreamableHTTPClientTransport(new URL(ctx.server), {
    requestInit: { headers },
    authProvider: cred.kind === "oauth" ? cred.provider : undefined,
    fetch: ctx.io.fetchFn,
  });
  try {
    await client.connect(transport);
  } catch (e) {
    throw connectionError(e, cred);
  }
  return client;
}

function connectionError(e: unknown, cred: Credential): Error {
  if (e instanceof CliError) return e;
  if (e instanceof UnauthorizedError || (e instanceof StreamableHTTPError && e.code === 401)) {
    return new CliError(
      cred.kind === "key"
        ? "TronRental refused the API key: it is wrong, disabled or deleted."
        : "The sign-in has expired or was revoked: run `tronrental login` again.",
    );
  }
  if (e instanceof StreamableHTTPError && e.code === 404) {
    return new CliError("The TronRental MCP endpoint is not available here (HTTP 404). Check --server / TRONRENTAL_MCP_URL.");
  }
  return new CliError(`Could not reach ${e instanceof Error ? e.message : String(e)}`);
}

async function allTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function emit(ctx: Context, data: unknown): void {
  ctx.io.stdout(ctx.globals.json ? JSON.stringify(data) : human(data));
}

/** A tool error: on stderr for a person, as `{"error": …}` on stdout for a script. */
function fail(ctx: Context, result: CallToolResult): number {
  const error = errorData(result);
  if (ctx.globals.json) ctx.io.stdout(JSON.stringify({ error }));
  else ctx.io.stderr(`Error${error.code ? ` ${error.code}` : ""}: ${error.message}`);
  return 1;
}

async function confirmWithdrawal(ctx: Context, client: Client, args: Record<string, unknown>): Promise<boolean | number> {
  const currency = String(args.currency ?? "TRX").toUpperCase();
  const feeResult = await call(client, "get_withdrawal_fee", { address: args.to_address });
  if (feeResult.isError) return fail(ctx, feeResult);
  const fee = resultData(feeResult) as Record<string, unknown>;
  const feeText =
    currency === "USDT"
      ? `${fee.fee_usdt ?? "?"} USDT`
      : `${fee.fee_trx ?? "?"} TRX${fee.free_available ? " (this one is free)" : ""}`;
  const summary = [
    "Withdrawal",
    `  amount:  ${args.amount_trx} ${currency}`,
    `  fee:     ${feeText}`,
    `  to:      ${args.to_address}`,
  ].join("\n");
  if (ctx.globals.dryRun) {
    emit(ctx, { would_call: "withdraw", arguments: args, fee });
    return 0;
  }
  ctx.io.stderr(summary);
  if (ctx.globals.yes) return true;
  if (!ctx.io.interactive) {
    throw new CliError("A withdrawal needs confirmation: run it in a terminal, or pass --yes in a script.", 2);
  }
  const answer = (await ctx.io.ask("Send this withdrawal? [y/N] ")).trim().toLowerCase();
  if (answer === "y" || answer === "yes") return true;
  ctx.io.stderr("Cancelled: nothing was sent.");
  return 0;
}

async function runTool(ctx: Context, word: string, positionals: string[], flags: Map<string, (string | true)[]>): Promise<number> {
  const alias = ALIASES[word];
  const name = alias?.tool ?? word.replace(/-/g, "_");
  const cred = (await credential(ctx))!;
  const client = await connect(ctx, cred);
  try {
    const tools = await allTools(client);
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      if (WITHDRAWAL_TOOLS.has(name)) {
        throw new CliError(
          cred.kind === "oauth"
            ? "Withdrawals need an API key with the withdraw scope: a browser sign-in never gets withdraw. Pass --api-key or set TRONRENTAL_API_KEY."
            : "This API key has no withdraw scope: add it to the key on tronrental.com → API.",
        );
      }
      throw new CliError(`Unknown command: ${word}. Run \`tronrental tools\` for the commands your credentials allow.`, 2);
    }
    if (ctx.globals.help) {
      ctx.io.stdout(commandHelp(tool, alias ? word : undefined));
      return 0;
    }
    const args = toolArguments(tool, flags, ctx.globals.input);
    const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
    for (const [prop, value] of Object.entries(alias?.defaults ?? {})) {
      if (args[prop] === undefined && prop in properties) args[prop] = value;
    }
    // `tronrental order 123`: one bare value fills the one required argument left.
    const left = missingRequired(tool, args);
    if (positionals.length === 1 && left.length === 1) args[left[0]] = toolArguments(tool, new Map([[left[0], [positionals[0]]]]))[left[0]];
    else if (positionals.length > 0) throw new CliError(`Unexpected argument: ${positionals[0]}`, 2);
    if ("idempotency_key" in properties) {
      if (ctx.globals.idempotencyKey) args.idempotency_key = ctx.globals.idempotencyKey;
      if (args.idempotency_key === undefined && !ctx.globals.dryRun) {
        args.idempotency_key = randomUUID();
        ctx.io.stderr(`idempotency key: ${args.idempotency_key} (to retry this safely: --idempotency-key ${args.idempotency_key})`);
      }
    } else if (ctx.globals.idempotencyKey) {
      throw new CliError(`${commandName(name)} takes no idempotency key`, 2);
    }
    const missing = missingRequired(tool, args);
    if (missing.length) {
      throw new CliError(`Missing ${missing.map((p) => `--${p.replace(/_/g, "-")}`).join(", ")}. See \`tronrental ${word} --help\`.`, 2);
    }

    if (name === "withdraw") {
      if (cred.kind !== "key") throw new CliError("Withdrawals need an API key with the withdraw scope.");
      const go = await confirmWithdrawal(ctx, client, args);
      if (go !== true) return go === false ? 0 : go;
    } else if (ctx.globals.dryRun) {
      const quoteName = QUOTES[name];
      const quoteTool = quoteName ? tools.find((t) => t.name === quoteName) : undefined;
      if (!quoteTool) {
        emit(ctx, { would_call: name, arguments: args, note: "No quote for this command; nothing was sent." });
        return 0;
      }
      const quoteProps = (quoteTool.inputSchema.properties ?? {}) as Record<string, unknown>;
      const quoteArgs = Object.fromEntries(Object.entries(args).filter(([k]) => k in quoteProps));
      const quote = await call(client, quoteName, quoteArgs);
      if (quote.isError) return fail(ctx, quote);
      emit(ctx, { would_call: name, arguments: args, quote: resultData(quote) });
      return 0;
    }

    const result = await call(client, name, args);
    if (result.isError) return fail(ctx, result);
    emit(ctx, resultData(result));
    return 0;
  } finally {
    await client.close().catch(() => {});
  }
}

export async function main(argv: string[], io: Io): Promise<number> {
  try {
    const { globals, positionals, flags } = parseArgv(argv);
    const ctx: Context = {
      globals,
      io,
      server: (globals.server ?? io.env.TRONRENTAL_MCP_URL?.trim()) || DEFAULT_SERVER,
    };
    if (globals.version) {
      io.stdout(VERSION);
      return 0;
    }
    const [word, ...rest] = positionals;
    if (!word || (word === "help" && rest.length === 0) || (globals.help && !word)) {
      io.stdout(HELP);
      return 0;
    }
    if (word === "help") return main([rest[0], "--help", ...argv.filter((a) => a !== "help" && a !== rest[0])], io);
    switch (word) {
      case "login": {
        const store = await io.store();
        await login(store, ctx.server, {
          registerClient: globals.registerClient,
          openBrowser: !globals.noBrowser,
          openUrl: io.openUrl,
          log: io.stderr,
        });
        io.stderr(`Signed in to ${ctx.server} (kept in the ${store.kind}).`);
        return 0;
      }
      case "logout": {
        const store = await io.store();
        const revoked = await logout(store, ctx.server);
        io.stderr(revoked ? "Signed out: the sign-in is revoked and forgotten." : "Signed out on this machine (nothing to revoke on the server).");
        return 0;
      }
      case "status": {
        const cred = await credential(ctx, false);
        const source = !cred
          ? "not signed in"
          : cred.kind === "key"
            ? globals.apiKey
              ? "API key (--api-key)"
              : "API key (TRONRENTAL_API_KEY)"
            : "browser sign-in (tronrental login)";
        const status: Record<string, unknown> = { server: ctx.server, credentials: source };
        if (cred) {
          const client = await connect(ctx, cred);
          try {
            status.commands = (await allTools(client)).length;
          } finally {
            await client.close().catch(() => {});
          }
        }
        emit(ctx, status);
        return 0;
      }
      case "tools": {
        const cred = (await credential(ctx))!;
        const client = await connect(ctx, cred);
        try {
          const tools = await allTools(client);
          if (globals.json) {
            emit(ctx, tools.map((t) => ({ command: commandName(t.name), tool: t.name, title: t.title ?? t.annotations?.title, read_only: t.annotations?.readOnlyHint ?? false })));
          } else {
            const width = Math.max(...tools.map((t) => commandName(t.name).length)) + 2;
            io.stdout(tools.map((t) => `${commandName(t.name).padEnd(width)}${t.title ?? t.annotations?.title ?? ""}`).join("\n"));
          }
        } finally {
          await client.close().catch(() => {});
        }
        return 0;
      }
      default:
        return await runTool(ctx, word, rest, flags);
    }
  } catch (e) {
    if (e instanceof CliError) {
      io.stderr(e.message);
      return e.exitCode;
    }
    io.stderr(`tronrental: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
