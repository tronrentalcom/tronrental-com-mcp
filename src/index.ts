#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TronRentalAPI, APIError } from "./api.js";
import { z } from "zod";

const api = new TronRentalAPI(process.env.TRONRENTAL_API_KEY);

function errorResult(e: unknown) {
  const msg = e instanceof APIError
    ? `Error ${e.status} [${e.code}]: ${e.message}`
    : e instanceof Error
      ? e.message
      : String(e);
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer(
  {
    name: "tronrental",
    version: "1.0.7",
  },
  {
    capabilities: { tools: {} },
    instructions: `TronRental MCP Server — buy TRON energy to reduce USDT (TRC-20) transfer fees by up to 80%.

## How TRON fees work
Every USDT transfer on TRON requires ~65,000 energy (or ~131,000 if the recipient has never held USDT).
Without energy, TRX is burned to cover the fee: 65,000 × 100 SUN = 6.43 TRX per transfer.
With rented energy, the transfer uses delegated energy instead of burning TRX.
The rental cost is typically ~1.8 TRX — saving ~72% compared to burning.

## Important
- "rental_cost_per_transfer_trx" from calculate_savings is the TOTAL cost the user pays per transfer when renting energy. There are no additional fees.
- Do NOT invent terms like "bandwidth fee" or other extra charges. The user pays ONLY the rental price.
- After showing savings, ALWAYS ask the user if they want to proceed with buying energy. Guide them through registration and purchase.

## Flow for new users
1. get_prices — show current energy pricing
2. calculate_savings — calculate savings for the user's volume
3. ASK the user: "Want to set this up? I can register an account and buy energy for your address."
4. register — ASK the user for their real email (they must be able to read it) and a password. Never invent or generate an address: the account only exists after the code from that inbox is entered.
5. ASK the user for the 6-digit code that TronRental sent to their email (valid 10 minutes)
6. verify_email_code — creates the account and signs in
7. create_api_key — generate API key
8. get_deposit_address — show TRX deposit address, ask user to send TRX
9. get_balance — check if deposit arrived
10. buy_energy — purchase energy for target address
11. get_order — confirm delegation succeeded

## Flow for users with API key (TRONRENTAL_API_KEY is set)
Skip steps 3-7. Go directly to get_balance, then buy_energy.

## Energy amounts
- 65,000 — for 1 USDT transfer (recipient already has USDT)
- 131,000 — for 1 USDT transfer (recipient never held USDT, needs new storage slot)
- Minimum: 1. Maximum: 5,000,000. Orders under 32,000 come from TronRental's own pool: if it cannot serve the address right now, buy_energy fails with POOL_EXHAUSTED and nothing is charged — retry later or buy 32,000 or more.
- Duration: always "1h" (energy is used within seconds, 1 hour is the rental window)`,
  }
);

// 1. get_prices
server.tool(
  "get_prices",
  "Get current TronRental energy and bandwidth prices, TRX/USD rate, and volume limits. No authentication required. Use this to show the user current market rates.",
  {},
  async () => {
    try {
      const prices = await api.getPrices();
      return ok(prices);
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 2. calculate_savings
server.tool(
  "calculate_savings",
  `Calculate TRX savings from renting energy vs burning TRX for USDT transfers.
Returns burn_cost (what the user pays without energy) and rental_cost (what they pay with TronRental).
The rental_cost is the TOTAL cost — there are no hidden or additional fees.
After showing results, ask the user if they want to proceed with buying energy.`,
  { monthly_transfers: z.number().int().min(1).max(10000).describe("Number of USDT transfers per month") },
  async ({ monthly_transfers }) => {
    try {
      const prices = await api.getPrices() as Record<string, unknown>;
      const energyTrx = prices.energy_trx as Record<string, string> | undefined;
      const burnCostTrx = prices.burn_cost_trx as string | undefined;

      const burnCostPerTransfer = burnCostTrx ? Number(burnCostTrx) : 6.43;
      let rentalCostPerTransfer = 1.8; // fallback

      if (energyTrx?.["1h"]) {
        rentalCostPerTransfer = Number(energyTrx["1h"]);
      }

      const burnTotal = burnCostPerTransfer * monthly_transfers;
      const rentalTotal = rentalCostPerTransfer * monthly_transfers;
      const savings = burnTotal - rentalTotal;
      const savingsPercent = ((savings / burnTotal) * 100).toFixed(1);

      return ok({
        monthly_transfers,
        burn_cost_per_transfer_trx: burnCostPerTransfer.toFixed(2),
        rental_cost_per_transfer_trx: rentalCostPerTransfer.toFixed(2),
        burn_total_trx: burnTotal.toFixed(2),
        rental_total_trx: rentalTotal.toFixed(2),
        savings_trx: savings.toFixed(2),
        savings_percent: `${savingsPercent}%`,
        explanation: `Without energy each USDT transfer burns ${burnCostPerTransfer} TRX. With TronRental energy rental the cost is ${rentalCostPerTransfer.toFixed(2)} TRX per transfer (this is the total cost, no extra fees). Savings: ${savingsPercent}%.`,
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// Password given to register/login for an address that has no account yet.
// The backend does not keep it next to the pending code (ADR-059): it has to
// come back with the code at verify, so it stays here, in this process only.
const pendingSignupPasswords = new Map<string, string>();
const emailKey = (email: string) => email.trim().toLowerCase();

const CODE_SENT_NEXT_STEP =
  "A 6-digit confirmation code was sent to this email (valid 10 minutes). The account does not exist yet. Ask the user to check their inbox (and spam folder) and tell you the code, then call verify_email_code with the email and the code. If no mail arrives within a couple of minutes, call resend_email_code.";

// 3. register
server.tool(
  "register",
  "Start registration of a new TronRental account. Requires the user's REAL email address — ask the user for it, never invent or generate one: TronRental mails a 6-digit code there and the account is created only when that code is passed to verify_email_code. Returns no token for a new address. If the email already has an account, use login instead.",
  {
    email: z.string().email().describe("The user's own email address — they will need to read the confirmation code from it"),
    password: z.string().min(8).describe("Password (min 8 chars, must contain uppercase, lowercase, and digit)"),
    language: z.string().length(2).default("en").describe("Language of the confirmation email (en, ru, zh, ko, etc.)"),
  },
  async ({ email, password, language }) => {
    try {
      const result = await api.register(email, password, language);
      if (result.access_token) {
        return ok({
          status: "registered",
          access_token: result.access_token,
          next_step: "Call create_api_key to generate an API key, then get_deposit_address to get the deposit address for funding.",
        });
      }
      pendingSignupPasswords.set(emailKey(email), password);
      return ok({ status: "email_code_sent", email, next_step: CODE_SENT_NEXT_STEP });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 4. login
server.tool(
  "login",
  "Log in to an existing TronRental account. Returns access token. For an email that has no account yet this starts registration instead: a 6-digit code is mailed and the account is created by verify_email_code.",
  {
    email: z.string().email().describe("Account email"),
    password: z.string().describe("Account password"),
  },
  async ({ email, password }) => {
    try {
      const result = await api.login(email, password);
      if (result.requires_2fa) {
        return ok({
          status: "2fa_required",
          note: "This account has 2FA enabled. The user must complete 2FA on the website at tronrental.com.",
        });
      }
      if (result.requires_email_code) {
        pendingSignupPasswords.set(emailKey(email), password);
        return ok({ status: "email_code_sent", email, next_step: CODE_SENT_NEXT_STEP });
      }
      return ok({
        status: "logged_in",
        access_token: result.access_token,
        next_step: "Use create_api_key if you need an API key, or get_balance to check the balance.",
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 4a. verify_email_code
server.tool(
  "verify_email_code",
  "Finish registration with the 6-digit code from the confirmation email (sent by register). Creates the account with the password given to register and signs in. Ask the user for the code — do not guess: each address allows only 5 attempts per code. After success, proceed to create_api_key.",
  {
    email: z.string().email().describe("The same email that was passed to register"),
    code: z.string().regex(/^\d{6}$/).describe("6-digit code from the email"),
    password: z.string().optional().describe("Only needed if this MCP server was restarted after register: the same password that was given to register"),
  },
  async ({ email, code, password }) => {
    try {
      const pwd = password ?? pendingSignupPasswords.get(emailKey(email));
      if (pwd === undefined) {
        return {
          content: [{ type: "text" as const, text: "No password for this email in this session. Pass the password that was given to register." }],
          isError: true,
        };
      }
      const result = await api.verifyEmailCode(email, code, pwd);
      if (result.requires_2fa) {
        return ok({
          status: "2fa_required",
          note: "This account has 2FA enabled. The user must complete 2FA on the website at tronrental.com.",
        });
      }
      pendingSignupPasswords.delete(emailKey(email));
      return ok({
        status: result.is_new ? "registered" : "logged_in",
        access_token: result.access_token,
        next_step: "Email confirmed. Call create_api_key to generate an API key, then get_deposit_address to get the deposit address for funding.",
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 4b. resend_email_code
server.tool(
  "resend_email_code",
  "Send a new confirmation code to the email given to register (use when the code expired or did not arrive). The previous code stops working. Limited to 3 emails per hour per address.",
  {
    email: z.string().email().describe("The same email that was passed to register"),
    language: z.string().length(2).default("en").describe("Language of the email (en, ru, zh, ko, etc.)"),
  },
  async ({ email, language }) => {
    try {
      await api.sendEmailCode(email, language);
      return ok({
        status: "email_code_sent",
        email,
        next_step: "Ask the user for the new 6-digit code from their inbox, then call verify_email_code.",
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 5. create_api_key
server.tool(
  "create_api_key",
  "Create an API key for authenticated operations. Requires a valid access token from verify_email_code or login. The key is shown only once — tell the user to save it. After creating, proceed to get_deposit_address.",
  {
    name: z.string().default("mcp-key").describe("Name for the API key"),
  },
  async ({ name }) => {
    try {
      const result = await api.createApiKey(name);
      return ok({
        api_key: result.key,
        key_id: result.id,
        next_step: "Key created. To persist it, the user should set TRONRENTAL_API_KEY in their MCP config. Now call get_deposit_address to get the TRX deposit address.",
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 6. get_deposit_address
server.tool(
  "get_deposit_address",
  "Get the TRX/USDT deposit address for funding the TronRental balance. Show this address to the user and ask them to send TRX. After they send, use get_balance to verify.",
  {},
  async () => {
    try {
      const result = await api.getDepositAddress();
      return ok({
        deposit_address: result.deposit_address,
        accepted_currencies: result.accepted_currencies,
        next_step: "Ask the user to send TRX or USDT to this address. Deposits are detected automatically within ~30 seconds. Then call get_balance to verify the deposit arrived.",
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 7. get_balance
server.tool(
  "get_balance",
  "Check current TronRental account balance in TRX. Use after deposit to verify funds arrived, or before buy_energy to check sufficient balance.",
  {},
  async () => {
    try {
      const result = await api.getBalance();
      return ok(result);
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 8. buy_energy
server.tool(
  "buy_energy",
  `Buy TRON energy for a target address. This is the core action — energy eliminates USDT transfer fees.
Use 65,000 for addresses that already hold USDT, or 131,000 for addresses that have never held USDT.
Minimum: 1. Maximum: 5,000,000. Duration is always "1h".
Under 32,000 the order is served from TronRental's own pool: POOL_EXHAUSTED means nothing was charged (retry later or buy 32,000+), and status "submitted_unknown" settles to "filled" or "failed" (refunded) within minutes.
After purchase, call get_order to confirm the energy was delegated.`,
  {
    target_address: z.string().describe("TRON address to receive energy (starts with T, 34 chars)"),
    volume: z.number().int().min(1).max(5000000).describe("Energy amount: 65000 for 1 transfer (recipient has USDT), 131000 (recipient has no USDT)"),
    duration: z.string().default("1h").describe("Rental duration — always use 1h"),
  },
  async ({ target_address, volume, duration }) => {
    try {
      const result = await api.buyEnergy(target_address, volume, duration);
      return ok(result);
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 9. get_order
server.tool(
  "get_order",
  "Check the status of an energy purchase order. Call after buy_energy to confirm the energy was successfully delegated to the target address.",
  {
    order_id: z.number().int().describe("Order ID returned from buy_energy"),
  },
  async ({ order_id }) => {
    try {
      const result = await api.getOrder(order_id);
      return ok(result);
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 10. regenerate_deposit_address
server.tool(
  "regenerate_deposit_address",
  "Generate a new deposit address, replacing the current one. Use only if the user explicitly asks for a new address. Rate limited to 1 per minute.",
  {},
  async () => {
    try {
      const result = await api.regenerateDepositAddress();
      return ok({
        deposit_address: result.deposit_address,
        accepted_currencies: result.accepted_currencies,
        note: "New deposit address generated. The previous address is no longer monitored for deposits.",
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// Start
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
