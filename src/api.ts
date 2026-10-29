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
    auth: "none" | "token" | "auto" = "auto"
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (auth === "auto") {
      // Prefer API key, fall back to access token
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      } else if (this.accessToken) {
        headers["Authorization"] = `Bearer ${this.accessToken}`;
      }
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

  // New addresses get no token here: the backend mails a 6-digit code and
  // answers requires_email_code; the account is created by verifyEmailCode.
  async register(
    email: string,
    password: string,
    language = "en"
  ): Promise<LoginResponse> {
    const data = await this.request<LoginResponse>(
      "POST", "/auth/register", { email, password, language }, "none"
    );
    if (data.access_token) this.accessToken = data.access_token;
    return data;
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const data = await this.request<LoginResponse>(
      "POST", "/auth/login", { email, password }, "none"
    );
    if (data.access_token) this.accessToken = data.access_token;
    return data;
  }

  async sendEmailCode(email: string, language = "en"): Promise<{ status: string }> {
    return this.request("POST", "/auth/email-code/send", { email, language }, "none");
  }

  async verifyEmailCode(
    email: string,
    code: string,
    password?: string
  ): Promise<LoginResponse> {
    const body: Record<string, unknown> = { email, code };
    if (password !== undefined) body.password = password;
    const data = await this.request<LoginResponse>(
      "POST", "/auth/email-code/verify", body, "none"
    );
    if (data.access_token) this.accessToken = data.access_token;
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

export interface LoginResponse {
  access_token?: string | null;
  requires_2fa?: boolean;
  requires_email_code?: boolean;
  is_new?: boolean;
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
