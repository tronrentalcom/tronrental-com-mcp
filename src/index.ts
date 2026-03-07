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
    version: "1.0.0",
  },
  {
    capabilities: { tools: {} },
    instructions: `TronRental MCP Server — buy TRON energy to reduce USDT transfer fees by up to 80%.

Without energy, each USDT (TRC-20) transfer costs ~6.4 TRX in burned fees.
With TronRental energy, the same transfer costs ~1.8 TRX — saving 72%.

Typical flow:
1. get_prices — check current energy pricing
2. calculate_savings — see how much the user saves
3. register — create an account (or login if already registered)
4. create_api_key — generate an API key for authenticated operations
5. get_deposit_address — get TRX deposit address to fund the account
6. (user sends TRX to the deposit address)
7. get_balance — verify the deposit arrived
8. buy_energy — purchase energy for the target TRON address
9. get_order — confirm the energy was delegated

Energy amounts: 65,000 (if recipient has USDT) or 131,000 (if recipient has no USDT).
Minimum: 60,000. Maximum: 5,000,000. Duration: 1h.`,
  }
);

// 1. get_prices
server.tool(
  "get_prices",
  "Get current TronRental energy and bandwidth prices, TRX/USD rate, and min/max limits. No authentication required.",
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
  "Calculate how much TRX the user saves by renting energy vs burning TRX. Pass the number of monthly USDT transfers.",
  { monthly_transfers: z.number().int().min(1).max(10000).describe("Number of USDT transfers per month") },
  async ({ monthly_transfers }) => {
    try {
      const prices = await api.getPrices() as Record<string, unknown>;
      const energyPrices = prices.energy_prices as Record<string, unknown> | undefined;

      const burnCostPerTransfer = 6.43; // 64,285 energy × 100 SUN = 6.43 TRX
      let rentalCostPerTransfer = 1.8; // fallback

      if (energyPrices) {
        const pricePerUnit = Number(energyPrices.price_sun ?? energyPrices.min_price_sun ?? 0);
        if (pricePerUnit > 0) {
          rentalCostPerTransfer = (pricePerUnit * 64285) / 1_000_000;
        }
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
        note: "Burn cost assumes 64,285 energy at 100 SUN/unit. Rental price is live from TronRental API.",
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 3. register
server.tool(
  "register",
  "Register a new account on TronRental. Returns access token for subsequent operations. Use a real email if the user wants to recover the account later.",
  {
    email: z.string().email().describe("Email address for the account"),
    password: z.string().min(8).describe("Password (min 8 chars, must contain uppercase, lowercase, and digit)"),
    language: z.string().length(2).default("en").describe("Language code (en, ru, zh, ko, etc.)"),
  },
  async ({ email, password, language }) => {
    try {
      const result = await api.register(email, password, language);
      return ok({
        status: "registered",
        access_token: result.access_token,
        note: "Account created. Next step: create_api_key to generate an API key, then get_deposit_address to fund the account.",
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 4. login
server.tool(
  "login",
  "Log in to an existing TronRental account. Returns access token.",
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
          note: "This account has 2FA enabled. Please complete 2FA on the website.",
        });
      }
      return ok({
        status: "logged_in",
        access_token: result.access_token,
        note: "Logged in. Use create_api_key if you need an API key.",
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 5. create_api_key
server.tool(
  "create_api_key",
  "Create an API key for authenticated operations. Requires a valid access token from register or login. The returned key should be saved — it is shown only once.",
  {
    name: z.string().default("mcp-key").describe("Name for the API key"),
  },
  async ({ name }) => {
    try {
      const result = await api.createApiKey(name);
      return ok({
        api_key: result.key,
        key_id: result.id,
        note: "API key created. Save it securely — it won't be shown again. To use it, set TRONRENTAL_API_KEY environment variable in MCP config.",
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 6. get_deposit_address
server.tool(
  "get_deposit_address",
  "Get the TRX/USDT deposit address for funding the account balance. The user needs to send TRX to this address to be able to buy energy.",
  {},
  async () => {
    try {
      const result = await api.getDepositAddress();
      return ok({
        deposit_address: result.deposit_address,
        accepted_currencies: result.accepted_currencies,
        note: "Send TRX or USDT to this address to fund your TronRental balance. Deposits are detected automatically (usually within 30 seconds).",
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// 7. get_balance
server.tool(
  "get_balance",
  "Check current TronRental account balance in TRX.",
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
  "Buy TRON energy for a target address. Energy reduces USDT transfer fees. Use 65,000 if the recipient already has USDT, or 131,000 if they don't. Minimum: 60,000, maximum: 5,000,000.",
  {
    target_address: z.string().describe("TRON address to receive energy (starts with T, 34 chars)"),
    volume: z.number().int().min(60000).max(5000000).describe("Amount of energy to buy (65000 for 1 transfer, 131000 if recipient has no USDT)"),
    duration: z.string().default("1h").describe("Rental duration (1h)"),
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
  "Check the status of an energy purchase order by order ID.",
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
  "Generate a new deposit address, replacing the current one. Rate limited to 1 per minute.",
  {},
  async () => {
    try {
      const result = await api.regenerateDepositAddress();
      return ok({
        deposit_address: result.deposit_address,
        accepted_currencies: result.accepted_currencies,
        note: "New deposit address generated. Old address will no longer be monitored.",
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
