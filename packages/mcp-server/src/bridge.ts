/**
 * stdio ↔ the TronRental remote MCP server. With an API key every tools/list and
 * tools/call goes to the server as is: the catalog, its checks and its answers are
 * the server's, the bridge keeps no tool definitions of its own. Without a key it
 * offers the headless sign-up (headless.ts) and switches once a key is issued.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { HEADLESS_INSTRUCTIONS, HEADLESS_TOOLS, Headless } from "./headless.js";
import { DEFAULT_API_URL, RestClient } from "./rest.js";

export const VERSION = "2.0.0";
export const DEFAULT_MCP_URL = "https://mcp.tronrental.com/mcp";

export interface BridgeConfig {
  apiKey?: string;
  /** The remote MCP endpoint (TRONRENTAL_MCP_URL). */
  mcpUrl?: string;
  /** The REST base of the headless sign-up (TRONRENTAL_API_URL). */
  apiUrl?: string;
  /** Act on a team account the key may act on (TRONRENTAL_ACCOUNT_ID → X-Account-Id). */
  accountId?: string;
  fetchFn?: typeof fetch;
}

const USER_AGENT = `tronrental-mcp/${VERSION}`;

function failure(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function remoteErrorText(e: unknown): string {
  if (e instanceof StreamableHTTPError && (e.code === 401 || e.code === 403)) {
    return `TronRental refused the API key (HTTP ${e.code}): it is wrong, disabled or deleted. Set a valid TRONRENTAL_API_KEY (tronrental.com → API) and restart this MCP server.`;
  }
  if (e instanceof StreamableHTTPError && e.code === 404) {
    return "The TronRental MCP endpoint is not available (HTTP 404). Check TRONRENTAL_MCP_URL.";
  }
  const message = e instanceof Error ? e.message : String(e);
  return `Could not reach the TronRental MCP server: ${message}`;
}

export class Bridge {
  private remote: Client | null = null;
  private apiKey: string | undefined;
  private readonly mcpUrl: string;
  readonly headless: Headless;
  /** Set once a key is issued mid-session: the client re-reads tools/list. */
  onToolsChanged: () => Promise<void> = async () => {};

  constructor(private config: BridgeConfig) {
    this.apiKey = config.apiKey || undefined;
    this.mcpUrl = config.mcpUrl || DEFAULT_MCP_URL;
    const rest = new RestClient(config.apiUrl || DEFAULT_API_URL, USER_AGENT, config.fetchFn);
    this.headless = new Headless(rest, async (key) => {
      this.apiKey = key;
      await this.closeRemote();
      await this.onToolsChanged();
    });
  }

  get hasKey(): boolean {
    return this.apiKey !== undefined;
  }

  private async connect(): Promise<Client> {
    if (this.remote) return this.remote;
    const headers: Record<string, string> = { "X-API-Key": this.apiKey!, "User-Agent": USER_AGENT };
    if (this.config.accountId) headers["X-Account-Id"] = this.config.accountId;
    const client = new Client({ name: "tronrental-mcp", version: VERSION });
    const transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl), {
      requestInit: { headers },
      fetch: this.config.fetchFn,
    });
    await client.connect(transport);
    this.remote = client;
    return client;
  }

  private async closeRemote(): Promise<void> {
    const remote = this.remote;
    this.remote = null;
    await remote?.close().catch(() => {});
  }

  /** The server's instructions when a key is set and the server answers; else the sign-up ones. */
  async instructions(): Promise<string> {
    if (!this.hasKey) return HEADLESS_INSTRUCTIONS;
    try {
      return (await this.connect()).getInstructions() ?? "";
    } catch {
      return "TronRental rents TRON energy and bandwidth. The TronRental MCP server could not be reached at start-up; tools/list retries.";
    }
  }

  async listTools(): Promise<Tool[]> {
    if (!this.hasKey) return HEADLESS_TOOLS;
    const remote = await this.connect();
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await remote.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.hasKey) return this.headless.call(name, args);
    try {
      const remote = await this.connect();
      return (await remote.callTool({ name, arguments: args })) as CallToolResult;
    } catch (e) {
      // The server answered with a protocol error: the connection is fine and nothing was done.
      if (e instanceof McpError && e.code !== ErrorCode.RequestTimeout && e.code !== ErrorCode.ConnectionClosed) {
        return failure(`TronRental MCP server: ${e.message}`);
      }
      // A dropped connection is re-opened on the next call.
      await this.closeRemote();
      const refused = e instanceof StreamableHTTPError && e.code !== undefined && e.code >= 400 && e.code < 500;
      return failure(
        refused
          ? remoteErrorText(e)
          : `${remoteErrorText(e)} The call may have reached TronRental: before repeating anything that spends, check (get_order, list_orders, get_balance) and retry with the same idempotency_key.`,
      );
    }
  }

  async close(): Promise<void> {
    await this.closeRemote();
  }
}

/** The stdio-side MCP server of a bridge. */
export async function createServer(bridge: Bridge): Promise<Server> {
  const server = new Server(
    { name: "tronrental", version: VERSION },
    { capabilities: { tools: { listChanged: true } }, instructions: await bridge.instructions() },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      return { tools: await bridge.listTools() };
    } catch (e) {
      // tools/list has no isError: say why in the one place a client shows.
      throw new Error(remoteErrorText(e));
    }
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    bridge.callTool(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>),
  );
  bridge.onToolsChanged = () => server.sendToolListChanged();
  return server;
}
