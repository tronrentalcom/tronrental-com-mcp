/**
 * Sign-up without a browser (no TRONRENTAL_API_KEY): the agent registers with the
 * user's email and the code mailed there, the user tops up the balance, and the
 * first API key is issued once the account's top-ups reach the bar. With the key
 * the bridge switches to the server's own tool catalog.
 */

import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { APIError, RestClient } from "./rest.js";

export const HEADLESS_INSTRUCTIONS = `TronRental rents TRON energy and bandwidth so that transfers cost less TRX.

No API key is configured, so only the sign-up tools are available:
1. get_energy_prices — current prices (no account needed).
2. register — ASK the user for their real email (they must read a code from it) and a password. Never invent an address.
3. ASK the user for the 6-digit code TronRental mailed to them (valid 10 minutes), then verify_email_code. If the email already has an account, use login instead.
4. get_deposit_address — show the address and ask the user to send TRX or USDT; get_balance shows when it arrived.
5. create_api_key — issued once the account's top-ups reach the bar (100 TRX on tronrental.com; a USDT top-up counts at its credited TRX amount). Below it the call says how much more to top up.
Once the key is created, the full TronRental tool set (quotes, buying energy and bandwidth, orders, subscriptions) appears in this session. Tell the user to save the key as TRONRENTAL_API_KEY in their MCP config so it keeps working next time.

The sign-in token is valid 1 hour: if a call fails with TOKEN_EXPIRED or INVALID_TOKEN, call login again.`;

const CODE_SENT_NEXT_STEP =
  "A 6-digit confirmation code was sent to this email (valid 10 minutes). The account does not exist yet. Ask the user to check their inbox (and spam folder) and tell you the code, then call verify_email_code with the email and the code. If no mail arrives within a couple of minutes, call resend_email_code.";

const NEXT_AFTER_SIGN_IN =
  "Call get_deposit_address and ask the user to top up; get_balance shows when the deposit arrived. Then call create_api_key: the key unlocks buying energy and bandwidth.";

const TWO_FA = {
  status: "2fa_required",
  note: "This account has 2FA enabled. Sign in on tronrental.com, create an API key on the API page and set it as TRONRENTAL_API_KEY.",
};

const email = { type: "string", format: "email" } as const;
const language = {
  type: "string",
  minLength: 2,
  maxLength: 2,
  default: "en",
  description: "Language of the email (en, ru, zh, ko, …)",
} as const;

export const HEADLESS_TOOLS: Tool[] = [
  {
    name: "get_energy_prices",
    description: "Current TronRental energy prices. No account needed. Read-only.",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "Get energy prices", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "register",
    description:
      "Start registration of a new TronRental account. Requires the user's REAL email — ask the user, never invent one: TronRental mails a 6-digit code there and the account is created only when that code is passed to verify_email_code. If the email already has an account, use login.",
    inputSchema: {
      type: "object",
      properties: {
        email: { ...email, description: "The user's own email: they will read the code from it" },
        password: { type: "string", minLength: 8, description: "Min 8 chars with an uppercase, a lowercase letter and a digit" },
        language,
      },
      required: ["email", "password"],
    },
    annotations: { title: "Register", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "verify_email_code",
    description:
      "Finish registration with the 6-digit code from the confirmation email. Creates the account with the password given to register and signs in. Ask the user for the code — do not guess: each address allows only 5 attempts per code.",
    inputSchema: {
      type: "object",
      properties: {
        email: { ...email, description: "The same email that was passed to register" },
        code: { type: "string", pattern: "^\\d{6}$", description: "6-digit code from the email" },
        password: {
          type: "string",
          description: "Only if this MCP server restarted after register: the same password given to register",
        },
      },
      required: ["email", "code"],
    },
    annotations: { title: "Verify email code", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "resend_email_code",
    description:
      "Mail a new confirmation code to the email given to register (expired or not received). The previous code stops working. At most 3 emails per hour per address.",
    inputSchema: { type: "object", properties: { email, language }, required: ["email"] },
    annotations: { title: "Resend email code", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "login",
    description:
      "Sign in to an existing TronRental account (the token is valid 1 hour). For an email with no account yet this starts registration instead: a code is mailed and verify_email_code creates the account.",
    inputSchema: {
      type: "object",
      properties: { email, password: { type: "string" } },
      required: ["email", "password"],
    },
    annotations: { title: "Log in", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_deposit_address",
    description:
      "The TRX/USDT deposit address of the signed-in account. Show it to the user and ask them to top up; deposits are detected within about 30 seconds. Read-only.",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "Get deposit address", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_balance",
    description: "The signed-in account's balance in TRX. Read-only.",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "Get balance", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "create_api_key",
    description:
      "Create the API key that unlocks the full tool set in this session and keeps access afterwards (the user saves it as TRONRENTAL_API_KEY). Needs the sign-in token. Issued only once the account's top-ups reach the bar (100 TRX on tronrental.com); below it the call reports how much more to top up. The key is shown only once — tell the user to save it.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", default: "mcp-key", description: "Name of the key" } },
    },
    annotations: { title: "Create API key", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }], isError: true };
}

function errorResult(e: unknown): CallToolResult {
  if (e instanceof APIError) {
    return fail({ error: { code: e.code || "HTTP_ERROR", message: e.message, status: e.status } });
  }
  return fail(e instanceof Error ? e.message : String(e));
}

// A new key waits for the account's top-ups to reach the bar —
// 403 API_KEY_DEPOSIT_REQUIRED with required_trx and missing_trx.
function depositRequired(e: APIError): CallToolResult {
  const required = e.details.required_trx as string | undefined;
  const missing = e.details.missing_trx as string | undefined;
  return fail({
    status: "deposit_required",
    required_trx: required ?? null,
    missing_trx: missing ?? null,
    explanation: `No API key yet: TronRental issues API keys once the account's top-ups total ${required ?? "the required amount of"} TRX${missing ? ` — ${missing} TRX more to go` : ""}. A USDT top-up counts at the TRX amount it was credited as.`,
    next_step:
      "Tell the user how much more to top up (get_deposit_address), check get_balance after the deposit, then call create_api_key again.",
  });
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export class Headless {
  // The backend does not keep the password next to the pending code: it
  // has to come back with the code at verify, so it stays here, in this process only.
  private pendingPasswords = new Map<string, string>();

  constructor(
    private rest: RestClient,
    /** Called with the new key: the bridge switches to the remote catalog. */
    private onApiKey: (key: string) => Promise<void>,
  ) {}

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const emailKey = (str(args.email) ?? "").trim().toLowerCase();
    try {
      switch (name) {
        case "get_energy_prices":
          return ok(await this.rest.getEnergyPrices());
        case "register": {
          const password = str(args.password) ?? "";
          const result = await this.rest.register(str(args.email) ?? "", password, str(args.language) ?? "en");
          if (result.access_token) return ok({ status: "registered", next_step: NEXT_AFTER_SIGN_IN });
          this.pendingPasswords.set(emailKey, password);
          return ok({ status: "email_code_sent", email: args.email, next_step: CODE_SENT_NEXT_STEP });
        }
        case "verify_email_code": {
          const password = str(args.password) ?? this.pendingPasswords.get(emailKey);
          if (password === undefined) {
            return fail("No password for this email in this session. Pass the password that was given to register.");
          }
          const result = await this.rest.verifyEmailCode(str(args.email) ?? "", str(args.code) ?? "", password);
          if (result.requires_2fa) return ok(TWO_FA);
          this.pendingPasswords.delete(emailKey);
          return ok({
            status: result.is_new ? "registered" : "logged_in",
            next_step: `Email confirmed. ${NEXT_AFTER_SIGN_IN}`,
          });
        }
        case "resend_email_code":
          await this.rest.sendEmailCode(str(args.email) ?? "", str(args.language) ?? "en");
          return ok({
            status: "email_code_sent",
            email: args.email,
            next_step: "Ask the user for the new 6-digit code from their inbox, then call verify_email_code.",
          });
        case "login": {
          const password = str(args.password) ?? "";
          const result = await this.rest.login(str(args.email) ?? "", password);
          if (result.requires_2fa) return ok(TWO_FA);
          if (result.requires_email_code) {
            this.pendingPasswords.set(emailKey, password);
            return ok({ status: "email_code_sent", email: args.email, next_step: CODE_SENT_NEXT_STEP });
          }
          return ok({ status: "logged_in", next_step: NEXT_AFTER_SIGN_IN });
        }
        case "get_deposit_address":
          return ok({
            ...(await this.rest.getDepositAddress()),
            next_step: "Ask the user to send TRX or USDT to this address, then call get_balance to see it arrive.",
          });
        case "get_balance":
          return ok(await this.rest.getBalance());
        case "create_api_key": {
          const result = await this.rest.createApiKey(str(args.name) ?? "mcp-key");
          await this.onApiKey(result.key);
          return ok({
            api_key: result.key,
            key_id: result.id,
            next_step:
              "Key created and in use for this session: the full TronRental tool set is now available. The key is shown only once — tell the user to save it as TRONRENTAL_API_KEY in their MCP config.",
          });
        }
        default:
          return fail(`Unknown tool: ${name}. Without an API key only the sign-up tools are available.`);
      }
    } catch (e) {
      if (e instanceof APIError && e.code === "API_KEY_DEPOSIT_REQUIRED") return depositRequired(e);
      return errorResult(e);
    }
  }
}
