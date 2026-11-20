#!/usr/bin/env node
/**
 * The guard `npm publish` runs first (`prepublishOnly` of each package). A version
 * on npm can never be published again, so a bad tarball is a lost version number:
 *
 *   1. the checkout is a clean `main` equal to `origin/main` (skipped with --no-git, CI);
 *   2. `dist` is deleted and built again from the sources;
 *   3. the package's tests pass;
 *   4. the built program reports the version in package.json (the CLI's --version,
 *      the bridge's serverInfo), and server.json names the same version;
 *   5. the tarball holds every `bin` file.
 *
 * Any failure exits non-zero and npm stops before uploading anything.
 * Run from a package directory: `node ../../scripts/prepublish.mjs [--no-git]`.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const pkgDir = process.cwd();
const root = resolve(pkgDir, "../..");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const checkGit = !process.argv.includes("--no-git");
const win = process.platform === "win32";

function fail(message) {
  console.error(`\nprepublish guard: ${message}\nNothing was published.`);
  process.exit(1);
}

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { cwd: pkgDir, encoding: "utf8", shell: win, ...options });
  if (r.error) fail(`${cmd} ${args.join(" ")}: ${r.error.message}`);
  return r;
}

function step(title) {
  console.error(`prepublish guard [${pkg.name}@${pkg.version}]: ${title}`);
}

// 1. A clean main equal to origin/main.
if (checkGit) {
  step("checkout is a clean, current main");
  const git = (...args) => run("git", args, { cwd: root });
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
  if (branch !== "main") fail(`publish from main, not ${branch}`);
  if (git("status", "--porcelain").stdout.trim()) fail("the working tree has uncommitted changes");
  if (git("fetch", "--quiet", "origin", "main").status !== 0) fail("git fetch origin main failed");
  const head = git("rev-parse", "HEAD").stdout.trim();
  const upstream = git("rev-parse", "origin/main").stdout.trim();
  if (head !== upstream) fail(`HEAD ${head.slice(0, 7)} is not origin/main ${upstream.slice(0, 7)}: git pull first`);
}

// 2. A clean build.
step("clean build");
rmSync(join(pkgDir, "dist"), { recursive: true, force: true });
if (run("npm", ["run", "build"], { stdio: "inherit" }).status !== 0) fail("the build failed");

// 3. Tests.
step("tests");
if (run("npm", ["test"], { stdio: "inherit" }).status !== 0) fail("the tests failed");

// 4. The built program says the version that is being published.
step("version of the built program");
const bins = Object.values(typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : (pkg.bin ?? {}));
if (pkg.name === "@tronrental-com/cli") {
  const said = run("node", [bins[0], "--version"]).stdout.trim();
  if (said !== pkg.version) fail(`dist says ${JSON.stringify(said)}, package.json says ${pkg.version} (src/version.ts)`);
} else if (pkg.name === "@tronrental-com/mcp-server") {
  const initialize = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prepublish", version: "0" } },
  });
  const env = { ...process.env };
  delete env.TRONRENTAL_API_KEY; // start offline: the sign-up mode answers initialize without the network
  const out = run("node", [bins[0]], { input: initialize + "\n", env, timeout: 15_000 }).stdout;
  const line = out.split("\n").find((l) => l.includes('"serverInfo"'));
  const said = line ? JSON.parse(line).result.serverInfo.version : "(no initialize answer)";
  if (said !== pkg.version) fail(`the bridge says ${said}, package.json says ${pkg.version} (src/bridge.ts VERSION)`);
  const server = JSON.parse(readFileSync(join(root, "server.json"), "utf8"));
  const entry = (server.packages ?? []).find((p) => p.identifier === pkg.name);
  if (server.version !== pkg.version || entry?.version !== pkg.version) {
    fail(`server.json says ${server.version} / ${entry?.version}, package.json says ${pkg.version}`);
  }
} else {
  fail(`no version check for ${pkg.name}: add one`);
}

// 5. The tarball holds the programs.
step("tarball contents");
const packed = run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"]);
if (packed.status !== 0) fail(`npm pack --dry-run failed: ${packed.stderr}`);
const files = new Set(JSON.parse(packed.stdout)[0].files.map((f) => f.path));
const missing = bins.map((b) => b.replace(/^\.\//, "")).filter((b) => !files.has(b));
if (missing.length) fail(`the tarball lacks ${missing.join(", ")}`);
if ([...files].some((f) => f.endsWith(".test.js"))) fail("the tarball holds compiled tests: check tsconfig.build.json");

step(`ok — ${files.size} files, version ${pkg.version}`);
