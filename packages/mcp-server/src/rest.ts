/**
 * The few REST calls of the headless sign-up (no API key yet): register, the
 * email code, login, the deposit address, the balance and the first API key.
 * Everything else goes through the remote MCP server with the key.
 */

export const DEFAULT_API_URL = "https://api.tronrental.com/v1";

export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Extra fields next to code/message, e.g. required_trx and missing_trx. */
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "APIError";
  }
}

export interface LoginResponse {
  access_token?: string | null;
  requires_2fa?: boolean;
  requires_email_code?: boolean;
  is_new?: boolean;
}

export class RestClient {
  /** The sign-in token from register, verify_email_code or login: valid 1 hour. */
  accessToken: string | null = null;

  constructor(
    private baseUrl: string = DEFAULT_API_URL,
    private userAgent = "tronrental-mcp",
    private fetchFn: typeof fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown, signedIn = false): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": this.userAgent };
    if (signedIn) {
      if (!this.accessToken) {
        throw new APIError(401, "NOT_SIGNED_IN", "Not signed in: call register and verify_email_code, or login, first.");
      }
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    const resp = await this.fetchFn(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await resp.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!resp.ok) {
      const detail = data?.detail ?? data;
      const error = detail?.error && typeof detail.error === "object" ? detail.error : null;
      const message =
        typeof detail === "string" ? detail : (error?.message ?? detail?.message ?? `HTTP ${resp.status}`);
      throw new APIError(resp.status, error?.code ?? "", message, error ?? {});
    }
    return data as T;
  }

  private keep(data: LoginResponse): LoginResponse {
    if (data.access_token) this.accessToken = data.access_token;
    return data;
  }

  getEnergyPrices(): Promise<Record<string, unknown>> {
    return this.request("GET", "/energy/prices");
  }

  // A new address gets no token here: the backend mails a 6-digit code and
  // answers requires_email_code; verifyEmailCode creates the account.
  async register(email: string, password: string, language = "en"): Promise<LoginResponse> {
    return this.keep(await this.request("POST", "/auth/register", { email, password, language }));
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    return this.keep(await this.request("POST", "/auth/login", { email, password }));
  }

  sendEmailCode(email: string, language = "en"): Promise<{ status: string }> {
    return this.request("POST", "/auth/email-code/send", { email, language });
  }

  async verifyEmailCode(email: string, code: string, password: string): Promise<LoginResponse> {
    return this.keep(await this.request("POST", "/auth/email-code/verify", { email, code, password }));
  }

  createApiKey(name: string): Promise<{ id: number; key: string }> {
    return this.request("POST", "/auth/api-keys", { name }, true);
  }

  getBalance(): Promise<Record<string, unknown>> {
    return this.request("GET", "/account/balance", undefined, true);
  }

  getDepositAddress(): Promise<Record<string, unknown>> {
    return this.request("GET", "/account/deposit", undefined, true);
  }
}
