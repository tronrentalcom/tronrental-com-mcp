/**
 * TronRental API client — thin wrapper over REST API.
 */

const BASE_URL = "https://api.tronrental.com/v1";

export class TronRentalAPI {
  private apiKey: string | null;
  private accessToken: string | null = null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? null;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    auth: "none" | "token" | "key" = "key"
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (auth === "key" && this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    } else if (auth === "token" && this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const resp = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await resp.json();

    if (!resp.ok) {
      const detail = data?.detail;
      const errorMsg =
        typeof detail === "string"
          ? detail
          : detail?.error?.message ?? detail?.message ?? JSON.stringify(detail);
      const errorCode = detail?.error?.code ?? "";
      throw new APIError(resp.status, errorCode, errorMsg);
    }

    return data as T;
  }

  // --- Public ---

  async getPrices(): Promise<Record<string, unknown>> {
    return this.request("GET", "/prices", undefined, "none");
  }

  // --- Auth ---

  async register(
    email: string,
    password: string,
    language = "en"
  ): Promise<{ access_token: string; is_new: boolean }> {
    const data = await this.request<{
      access_token: string;
      is_new: boolean;
    }>("POST", "/auth/register", { email, password, language }, "none");
    this.accessToken = data.access_token;
    return data;
  }

  async login(
    email: string,
    password: string
  ): Promise<{ access_token: string; requires_2fa: boolean }> {
    const data = await this.request<{
      access_token: string;
      requires_2fa: boolean;
    }>("POST", "/auth/login", { email, password }, "none");
    this.accessToken = data.access_token;
    return data;
  }

  async createApiKey(name = "mcp-key"): Promise<{ id: number; key: string }> {
    return this.request("POST", "/auth/api-keys", { name }, "token");
  }

  // --- Account ---

  async getBalance(): Promise<{ balance_trx: string }> {
    return this.request("GET", "/account/balance");
  }

  async getDepositAddress(): Promise<{
    deposit_address: string;
    accepted_currencies: string[];
  }> {
    return this.request("GET", "/account/deposit");
  }

  async regenerateDepositAddress(): Promise<{
    deposit_address: string;
    accepted_currencies: string[];
  }> {
    return this.request("POST", "/account/deposit/regenerate");
  }

  // --- Energy ---

  async buyEnergy(
    targetAddress: string,
    volume: number,
    duration = "1h"
  ): Promise<Record<string, unknown>> {
    return this.request("POST", "/energy/buy", {
      target_address: targetAddress,
      volume,
      duration,
      source: "mcp",
    });
  }

  // --- Orders ---

  async getOrder(orderId: number): Promise<Record<string, unknown>> {
    return this.request("GET", `/orders/${orderId}`);
  }
}

export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "APIError";
  }
}
