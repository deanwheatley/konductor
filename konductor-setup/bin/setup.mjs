#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf-8")
);

// --- CLI arg parsing ---

const args = process.argv.slice(2);

function getFlag(name) {
  return args.includes(`--${name}`);
}

function getOption(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

const showHelp = getFlag("help");
const showVersion = getFlag("version");
const workspaceOnly = getFlag("workspace");
const checkUpdate = getFlag("check-update");
const serverUrl = getOption("server") || "http://localhost:3010";
const apiKey = getOption("api-key");

// --- Help ---

if (showHelp) {
  console.log(`
npx konductor-setup --server <url> --api-key <key>

Options:
  --server <url>        Konductor server URL (required)
  --api-key <key>       API key for authentication (recommended)
  --version             Print package version
  --help                Show help
`.trim());
  process.exit(0);
}

// --- Version ---

if (showVersion) {
  console.log(pkg.version);
  process.exit(0);
}

// --- Imports (lazy so --help and --version stay fast) ---

const { fetchBundle } = await import("../lib/bundle-fetcher.mjs");
const { detectWorkspaceRoot } = await import("../lib/workspace.mjs");
const { installGlobal, installWorkspace, checkUpdate: checkUpdateFn } = await import(
  "../lib/installer.mjs"
);

// --- Main orchestration ---

async function main() {
  const workspaceRoot = detectWorkspaceRoot();

  // Internal --check-update flow (used by watcher auto-update)
  if (checkUpdate) {
    await checkUpdateFn(serverUrl, workspaceRoot);
    return;
  }

  // Fetch bundle (server or embedded fallback)
  const bundle = await fetchBundle(serverUrl);
  console.log(`Bundle source: ${bundle.source} (v${bundle.version})`);

  // Always run both global and workspace setup.
  // --workspace is an internal flag for auto-updates only.
  if (!workspaceOnly) {
    await installGlobal(bundle.bundleDir, apiKey, serverUrl);
  }

  await installWorkspace(bundle.bundleDir, workspaceRoot, bundle.version, serverUrl, apiKey);

  // Summary
  console.log("--- Konductor Setup Complete ---");
  console.log(`  Version: ${bundle.version}`);
  console.log(`  Server:  ${serverUrl}`);
  console.log(`  Root:    ${workspaceRoot}`);

  // Verify server is reachable
  try {
    const headers = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const healthRes = await fetch(`${serverUrl}/health`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (healthRes.ok) {
      console.log(`  ✅ Konductor server reachable (${serverUrl})`);
      console.log(`  ℹ️  Kiro will detect the config change and connect automatically`);
    } else {
      console.log(`  ⚠️  Server responded with ${healthRes.status} — check your server URL and API key`);
    }
  } catch {
    console.log(`  ⚠️  Could not reach server at ${serverUrl} — verify the server is running`);
  }

  if (!apiKey) {
    console.log("  ⚠️  No --api-key provided. Edit ~/.kiro/settings/mcp.json to set it.");
  }
}

main().catch((err) => {
  console.error("Setup failed:", err.message || err);
  process.exit(1);
});
