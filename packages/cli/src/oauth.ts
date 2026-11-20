/**
 * `tronrental login`: OAuth 2.1 authorization code with PKCE through a loopback
 * redirect (RFC 8252). The client is our Client ID Metadata Document on
 * tronrental.com, so the consent screen shows «TronRental CLI» as a verified app.
 * Discovery, PKCE, the code exchange and refresh are the MCP SDK's.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Session, SessionStore } from "./store.js";

export const CLIENT_METADATA_URL = "https://tronrental.com/oauth-clients/tronrental-cli.json";
const LOGIN_TIMEOUT_MS = 5 * 60_000;

export class CliError extends Error {
  constructor(
    message: string,
    public exitCode = 1,
  ) {
    super(message);
  }
}

/** One server's session in the store, as the SDK's OAuth provider. */
export class StoredOAuthProvider implements OAuthClientProvider {
  private verifier = "";
  private expectedState = "";
  clientMetadataUrl?: string;
  redirectUri?: string;
  /** Called when a fresh sign-in is needed: `login` opens the browser, other commands fail. */
  onRedirect: (url: URL) => void | Promise<void> = () => {
    throw new CliError("The sign-in has expired or was revoked: run `tronrental login` again.");
  };

  /** Login's choice of client; undefined for other commands: the stored client, whichever it is. */
  private registerClient: boolean | undefined;

  constructor(
    private store: SessionStore,
    private server: string,
    private session: Session,
    { registerClient }: { registerClient?: boolean } = {},
  ) {
    this.registerClient = registerClient;
    const dcr = registerClient ?? (session.clientInformation !== undefined && session.clientInformation.client_id !== CLIENT_METADATA_URL);
    this.clientMetadataUrl = dcr ? undefined : CLIENT_METADATA_URL;
  }

  // Always a redirect URL: without one the SDK takes this for a non-interactive client and,
  // on a 401, asks for a token without a code instead of refreshing. Outside `login` it is
  // never visited — a sign-in that cannot be refreshed ends in onRedirect's error.
  get redirectUrl(): string {
    return this.redirectUri ?? "http://127.0.0.1/callback";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "TronRental CLI",
      client_uri: "https://github.com/tronrentalcom/tronrental-com-mcp",
      redirect_uris: [this.redirectUri ?? "http://127.0.0.1/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    this.expectedState = randomBytes(16).toString("base64url");
    return this.expectedState;
  }

  get stateValue(): string {
    return this.expectedState;
  }

  private async persist(): Promise<void> {
    await this.store.save(this.server, this.session);
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const info = this.session.clientInformation;
    // At login, a client from the other way of signing in (DCR vs the metadata document) is not reused.
    if (info && this.registerClient !== undefined && (info.client_id === CLIENT_METADATA_URL) === this.registerClient) {
      return undefined;
    }
    return info;
  }
  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    this.session.clientInformation = info;
    await this.persist();
  }
  tokens(): OAuthTokens | undefined {
    return this.session.tokens;
  }
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.session.tokens = tokens;
    await this.persist();
  }
  /** What the authorization server promised in its metadata (RFC 8414), once discovered. */
  serverMetadata(): { issuer?: string; authorization_response_iss_parameter_supported?: boolean } {
    return (this.discoveryState()?.authorizationServerMetadata ?? {}) as { issuer?: string; authorization_response_iss_parameter_supported?: boolean };
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.session.discoveryState as OAuthDiscoveryState | undefined;
  }
  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.session.discoveryState = state;
    await this.persist();
  }
  async redirectToAuthorization(url: URL): Promise<void> {
    await this.onRedirect(url);
  }
  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }
  codeVerifier(): string {
    return this.verifier;
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all" || scope === "client") delete this.session.clientInformation;
    if (scope === "all" || scope === "tokens") delete this.session.tokens;
    if (scope === "all" || scope === "discovery") delete this.session.discoveryState;
    await this.persist();
  }
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // the URL is printed anyway
  }
}

interface Callback {
  code: string;
}

function listenForCallback(provider: StoredOAuthProvider, issuer: string): Promise<{ server: Server; result: Promise<Callback> }> {
  return new Promise((resolveListen, rejectListen) => {
    let settle: (cb: Callback) => void;
    let fail: (e: Error) => void;
    const result = new Promise<Callback>((res, rej) => {
      settle = res;
      fail = rej;
    });
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const page = (title: string, body: string) =>
        res
          .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;margin:3em"><h2>${title}</h2><p>${body}</p>`);
      const params = url.searchParams;
      if (params.get("state") !== provider.stateValue) {
        page("Sign-in failed", "The answer does not match this sign-in. Run <code>tronrental login</code> again.");
        fail(new CliError("Sign-in failed: the callback's state does not match."));
        return;
      }
      // RFC 9207: the code must come from the server we started at (mix-up defence),
      // and a server that promises `iss` must send it.
      const iss = params.get("iss");
      const metadata = provider.serverMetadata();
      const expected = metadata.issuer ?? issuer;
      if (iss === null ? metadata.authorization_response_iss_parameter_supported === true : iss !== expected) {
        page("Sign-in failed", "The answer did not come from the server this sign-in started at.");
        fail(new CliError(`Sign-in failed: the callback's iss is ${iss ?? "missing"}, expected ${expected}.`));
        return;
      }
      const error = params.get("error");
      if (error) {
        page("Sign-in cancelled", "You can close this tab.");
        fail(new CliError(`Sign-in was not completed: ${error}${params.get("error_description") ? ` (${params.get("error_description")})` : ""}`));
        return;
      }
      const code = params.get("code");
      if (!code) {
        page("Sign-in failed", "No authorization code in the answer.");
        fail(new CliError("Sign-in failed: no authorization code."));
        return;
      }
      page("Signed in to TronRental", "You can close this tab and return to the terminal.");
      settle({ code });
    });
    server.on("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen({ server, result }));
  });
}

export interface LoginOptions {
  registerClient?: boolean;
  openBrowser?: boolean;
  /** How the sign-in page is opened (tests); the system browser by default. */
  openUrl?: (url: string) => void;
  log: (line: string) => void;
}

/** Sign in to `serverUrl` in the browser and keep the tokens. */
export async function login(store: SessionStore, serverUrl: string, options: LoginOptions): Promise<void> {
  const session = await store.load(serverUrl);
  delete session.tokens; // a fresh grant, whatever was there
  const provider = new StoredOAuthProvider(store, serverUrl, session, { registerClient: options.registerClient });
  // The authorization server of our MCP endpoint is its own origin (checked against
  // `iss` in the callback); discovery confirms it before the browser opens.
  const issuer = new URL(serverUrl).origin;
  const { server, result } = await listenForCallback(provider, issuer);
  try {
    provider.redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
    provider.onRedirect = (url) => {
      options.log(`Opening the TronRental sign-in page. If the browser does not open, visit:\n\n  ${url.href}\n`);
      if (options.openBrowser !== false) (options.openUrl ?? openBrowser)(url.href);
    };
    const started = await auth(provider, { serverUrl });
    if (started === "AUTHORIZED") return;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new CliError("Sign-in timed out after 5 minutes.")), LOGIN_TIMEOUT_MS).unref(),
    );
    const { code } = await Promise.race([result, timeout]);
    await auth(provider, { serverUrl, authorizationCode: code });
  } finally {
    server.close();
  }
}

/** Revoke the refresh token (and with it the grant's access) and forget the session. */
export async function logout(store: SessionStore, serverUrl: string): Promise<"revoked" | "failed" | "nothing"> {
  const session = await store.load(serverUrl);
  const token = session.tokens?.refresh_token ?? session.tokens?.access_token;
  const metadata = (session.discoveryState as OAuthDiscoveryState | undefined)?.authorizationServerMetadata as
    | { revocation_endpoint?: string }
    | undefined;
  const clientId = session.clientInformation?.client_id;
  let outcome: "revoked" | "failed" | "nothing" = "nothing";
  if (token && metadata?.revocation_endpoint && clientId) {
    const body = new URLSearchParams({ token, client_id: clientId });
    if (session.tokens?.refresh_token) body.set("token_type_hint", "refresh_token");
    try {
      const resp = await fetch(metadata.revocation_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      outcome = resp.ok ? "revoked" : "failed";
    } catch {
      outcome = "failed";
    }
  } else if (token) {
    outcome = "failed";
  }
  await store.remove(serverUrl);
  return outcome;
}
