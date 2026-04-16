/**
 * Bundle fetcher — downloads manifest + files from server, falls back to embedded bundle.
 * Uses only node:http / node:https (zero dependencies).
 */

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import https from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Make an HTTP(S) GET request. Returns { statusCode, body } on success.
 * Rejects on network error or timeout.
 *
 * @param {string} url
 * @returns {Promise<{ statusCode: number, body: Buffer }>}
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;

    const req = client.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks) });
      });
      res.on("error", reject);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on("error", reject);
  });
}

/**
 * Return the embedded fallback bundle directory and version.
 * Reads version from the package.json of konductor-setup.
 *
 * @returns {{ source: "embedded", version: string, bundleDir: string }}
 */
function embeddedFallback() {
  const bundleDir = resolve(__dirname, "..", "bundle");
  const pkgPath = resolve(__dirname, "..", "package.json");
  let version = "0.1.0";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    version = pkg.version || version;
  } catch {
    // Use default version
  }
  return { source: "embedded", version, bundleDir };
}

/**
 * Fetch the bundle from the Konductor server. Falls back to the embedded
 * bundle directory on any failure (network error, timeout, non-200, partial download).
 *
 * @param {string} serverUrl — e.g. "http://localhost:3010"
 * @returns {Promise<{ source: "server" | "embedded", version: string, bundleDir: string }>}
 */
export async function fetchBundle(serverUrl) {
  // Normalize: strip trailing slash
  const base = serverUrl.replace(/\/+$/, "");

  // Step 1: Fetch manifest
  let manifest;
  try {
    const manifestUrl = `${base}/bundle/manifest.json`;
    const res = await httpGet(manifestUrl);

    if (res.statusCode !== 200) {
      console.warn(
        `  ⚠️  Server returned ${res.statusCode} for manifest — using embedded bundle`
      );
      return embeddedFallback();
    }

    manifest = JSON.parse(res.body.toString("utf-8"));

    if (!manifest.version || !Array.isArray(manifest.files)) {
      console.warn("  ⚠️  Invalid manifest format — using embedded bundle");
      return embeddedFallback();
    }
  } catch (err) {
    console.warn(
      `  ⚠️  Could not reach server (${err.message}) — using embedded bundle`
    );
    return embeddedFallback();
  }

  // Step 2: Download each file into a temp directory
  let tempDir;
  try {
    tempDir = mkdtempSync(join(tmpdir(), "konductor-bundle-"));
  } catch (err) {
    console.warn(
      `  ⚠️  Could not create temp directory (${err.message}) — using embedded bundle`
    );
    return embeddedFallback();
  }

  try {
    for (const filePath of manifest.files) {
      const fileUrl = `${base}/bundle/files/${filePath}`;
      const res = await httpGet(fileUrl);

      if (res.statusCode !== 200) {
        throw new Error(
          `Server returned ${res.statusCode} for file: ${filePath}`
        );
      }

      const dest = resolve(tempDir, filePath);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, res.body);
    }
  } catch (err) {
    console.warn(
      `  ⚠️  File download failed (${err.message}) — using embedded bundle`
    );
    return embeddedFallback();
  }

  return {
    source: "server",
    version: manifest.version,
    bundleDir: tempDir,
  };
}
