/**
 * Command-line flags → tool arguments, by the tool's own `inputSchema` from the
 * server: `buy_energy`'s `target_address` is `--target-address`, an integer is
 * checked as one, an array takes repeats or commas, an object takes JSON.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { CliError } from "./oauth.js";

type Schema = { type?: string | string[]; anyOf?: Schema[]; items?: Schema; enum?: unknown[]; description?: string; default?: unknown };

export interface GlobalFlags {
  json: boolean;
  dryRun: boolean;
  yes: boolean;
  help: boolean;
  version: boolean;
  apiKey?: string;
  server?: string;
  account?: string;
  idempotencyKey?: string;
  input?: string;
  registerClient: boolean;
  noBrowser: boolean;
}

const GLOBAL_BOOLEAN: Record<string, keyof GlobalFlags> = {
  "--json": "json",
  "--dry-run": "dryRun",
  "--yes": "yes",
  "-y": "yes",
  "--help": "help",
  "-h": "help",
  "--version": "version",
  "--register-client": "registerClient",
  "--no-browser": "noBrowser",
};
const GLOBAL_VALUE: Record<string, keyof GlobalFlags> = {
  "--api-key": "apiKey",
  "--server": "server",
  "--account": "account",
  "--idempotency-key": "idempotencyKey",
  "--input": "input",
};

export interface Parsed {
  globals: GlobalFlags;
  positionals: string[];
  /** The command's own flags, raw: name without dashes → values in order. */
  flags: Map<string, (string | true)[]>;
}

/** Split argv into the global flags, the command words and the command's flags. */
export function parseArgv(argv: string[]): Parsed {
  const globals: GlobalFlags = { json: false, dryRun: false, yes: false, help: false, version: false, registerClient: false, noBrowser: false };
  const positionals: string[] = [];
  const flags = new Map<string, (string | true)[]>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    const eq = token.startsWith("--") ? token.indexOf("=") : -1;
    const name = eq > 0 ? token.slice(0, eq) : token;
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;
    if (name in GLOBAL_BOOLEAN && inline === undefined) {
      (globals as unknown as Record<string, unknown>)[GLOBAL_BOOLEAN[name]] = true;
    } else if (name in GLOBAL_VALUE) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new CliError(`${name} needs a value`, 2);
      (globals as unknown as Record<string, unknown>)[GLOBAL_VALUE[name]] = value;
    } else if (name.startsWith("--") && name.length > 2) {
      const key = name.slice(2);
      let value: string | true = true;
      if (inline !== undefined) value = inline;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) value = argv[++i];
      flags.set(key, [...(flags.get(key) ?? []), value]);
    } else {
      positionals.push(token);
    }
  }
  return { globals, positionals, flags };
}

export const flagName = (prop: string) => prop.replace(/_/g, "-");
export const commandName = (tool: string) => tool.replace(/_/g, "-");

/** Friendly flags of the common commands, as in the docs: `--address`, `--amount`, `--max-price`. */
const SYNONYMS: Record<string, string[]> = {
  address: ["target_address", "to_address", "address"],
  amount: ["volume", "amount_trx", "amount"],
  "max-price": ["max_price_trx"],
};

function types(schema: Schema): string[] {
  if (schema.anyOf) return schema.anyOf.flatMap(types);
  if (Array.isArray(schema.type)) return schema.type;
  return schema.type ? [schema.type] : [];
}

const NUMERIC = /^-?(\d+\.?\d*|\.\d+)$/;

function coerce(prop: string, schema: Schema, raw: string | true): unknown {
  const kinds = types(schema);
  if (raw === true) {
    if (kinds.includes("boolean")) return true;
    throw new CliError(`--${flagName(prop)} needs a value`, 2);
  }
  if (kinds.includes("boolean") && (raw === "true" || raw === "false")) return raw === "true";
  if (kinds.includes("integer") && /^-?\d+$/.test(raw)) return Number(raw);
  if (kinds.includes("number") && NUMERIC.test(raw)) return Number(raw);
  if (kinds.includes("object") || (kinds.includes("array") && raw.trimStart().startsWith("["))) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new CliError(`--${flagName(prop)}: not valid JSON`, 2);
    }
  }
  if (kinds.includes("null") && raw === "null") return null;
  if (kinds.length === 0 || kinds.includes("string")) return raw;
  throw new CliError(`--${flagName(prop)}: expected ${kinds.join(" or ")}, got ${JSON.stringify(raw)}`, 2);
}

/** The tool's arguments from the command's flags (and `--input` JSON underneath them). */
export function toolArguments(tool: Tool, flags: Map<string, (string | true)[]>, input?: string): Record<string, unknown> {
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, Schema>;
  const byFlag = new Map(Object.keys(properties).map((p) => [flagName(p), p]));
  let args: Record<string, unknown> = {};
  if (input !== undefined) {
    try {
      args = JSON.parse(input);
    } catch {
      throw new CliError("--input: not valid JSON", 2);
    }
  }
  const given = new Map<string, string>();
  for (const [flag, values] of flags) {
    let prop = byFlag.get(flag) ?? (properties[flag] ? flag : undefined);
    if (!prop && SYNONYMS[flag]) prop = SYNONYMS[flag].find((p) => p in properties);
    if (!prop) {
      const known = [...byFlag.keys()].map((f) => `--${f}`).join(", ") || "none";
      throw new CliError(`Unknown flag --${flag} for ${commandName(tool.name)}. Its flags: ${known}`, 2);
    }
    // `--amount` and `--volume` both name `volume`: two values for one argument is a mistake, not a choice.
    if (given.has(prop)) throw new CliError(`--${flag} is given more than once (also as --${given.get(prop)})`, 2);
    given.set(prop, flag);
    const schema = properties[prop];
    if (types(schema).includes("array")) {
      const items = schema.items ?? {};
      args[prop] = values.flatMap((v) => {
        if (v === true) throw new CliError(`--${flagName(prop!)} needs a value`, 2);
        if (v.trimStart().startsWith("[")) return coerce(prop!, schema, v) as unknown[];
        return v.split(",").map((part) => coerce(prop!, items, part.trim()));
      });
    } else {
      if (values.length > 1) throw new CliError(`--${flagName(prop)} is given more than once`, 2);
      args[prop] = coerce(prop, schema, values[0]);
    }
  }
  return args;
}

export function missingRequired(tool: Tool, args: Record<string, unknown>): string[] {
  return (tool.inputSchema.required ?? []).filter((p) => args[p] === undefined);
}

/** `tronrental <command> --help`: the flags from the schema. */
export function commandHelp(tool: Tool, alias?: string): string {
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, Schema>;
  const required = new Set(tool.inputSchema.required ?? []);
  const lines = [`tronrental ${alias ?? commandName(tool.name)}${alias ? `  (= ${commandName(tool.name)})` : ""}`, "", tool.description ?? "", ""];
  const rows = Object.entries(properties).map(([prop, schema]) => {
    const kind = types(schema).filter((t) => t !== "null").join("|") || "value";
    const notes = [
      required.has(prop) ? "required" : "",
      schema.enum ? `one of ${schema.enum.join(", ")}` : "",
      schema.default !== undefined ? `default ${JSON.stringify(schema.default)}` : "",
      schema.description ?? "",
    ].filter(Boolean);
    return [`  --${flagName(prop)} <${kind}>`, notes.join("; ")];
  });
  if (rows.length) {
    const width = Math.max(...rows.map((r) => r[0].length)) + 2;
    lines.push("Flags:", ...rows.map(([a, b]) => a.padEnd(width) + b), "");
  }
  lines.push("Global: --json, --dry-run, --idempotency-key <key>, --input <json>, --api-key <key>, --server <url>, --account <id>");
  return lines.join("\n");
}
