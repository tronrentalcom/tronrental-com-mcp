/**
 * Where `tronrental login` keeps the OAuth session of each server: the OS keychain
 * (macOS Keychain, Windows Credential Manager, Linux Secret Service). Where there is
 * none (a Linux server without a Secret Service), a 0600 file in the config dir.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

export interface Session {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  /** The authorization server's metadata, kept for refresh and revocation. */
  discoveryState?: unknown;
}

export interface SessionStore {
  readonly kind: string;
  load(server: string): Promise<Session>;
  save(server: string, session: Session): Promise<void>;
  remove(server: string): Promise<void>;
}

const SERVICE = "tronrental-cli";

export class KeyringStore implements SessionStore {
  readonly kind = "OS keychain";
  constructor(private Entry: new (service: string, user: string) => KeyringEntry) {}

  async load(server: string): Promise<Session> {
    const raw = new this.Entry(SERVICE, server).getPassword();
    return raw ? (JSON.parse(raw) as Session) : {};
  }
  async save(server: string, session: Session): Promise<void> {
    new this.Entry(SERVICE, server).setPassword(JSON.stringify(session));
  }
  async remove(server: string): Promise<void> {
    try {
      new this.Entry(SERVICE, server).deletePassword();
    } catch {
      // nothing stored
    }
  }
}

interface KeyringEntry {
  getPassword(): string | null | undefined;
  setPassword(password: string): void;
  deletePassword(): boolean | void;
}

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || (process.platform === "win32" ? process.env.APPDATA : undefined);
  return join(base || join(homedir(), ".config"), "tronrental");
}

export class FileStore implements SessionStore {
  readonly kind: string;
  constructor(private path = join(configDir(), "credentials.json")) {
    this.kind = `file ${path}`;
  }

  private all(): Record<string, Session> {
    return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as Record<string, Session>) : {};
  }
  private write(all: Record<string, Session>): void {
    mkdirSync(join(this.path, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(all, null, 2), { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
  async load(server: string): Promise<Session> {
    return this.all()[server] ?? {};
  }
  async save(server: string, session: Session): Promise<void> {
    this.write({ ...this.all(), [server]: session });
  }
  async remove(server: string): Promise<void> {
    const all = this.all();
    delete all[server];
    this.write(all);
  }
}

/** The keychain when it works on this machine, else the file. TRONRENTAL_NO_KEYRING=1 forces the file. */
export async function defaultStore(): Promise<SessionStore> {
  if (process.env.TRONRENTAL_NO_KEYRING !== "1") {
    try {
      const { Entry } = await import("@napi-rs/keyring");
      // Probe: a machine without a Secret Service fails here, not in the middle of a login.
      new Entry(SERVICE, "probe").getPassword();
      return new KeyringStore(Entry);
    } catch {
      process.stderr.write("tronrental: no OS keychain available; the sign-in is kept in a 0600 file instead\n");
    }
  }
  return new FileStore();
}
