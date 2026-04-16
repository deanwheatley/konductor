/**
 * Property-based tests for installer.mjs
 * Uses fast-check to verify correctness properties from the design document.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  cpSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// We need to mock homedir, execSync, and platform modules before importing installer
vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    homedir: vi.fn(() => original.homedir()),
    hostname: original.hostname,
  };
});

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => {
    throw new Error("mocked");
  }),
  spawn: vi.fn(() => ({ pid: 1, unref: vi.fn() })),
}));

const os = await import("node:os");
const { installGlobal, detectMode } = await import("./installer.mjs");

/**
 * Arbitrary for generating non-placeholder API keys.
 * Keys are non-empty strings that are NOT "YOUR_API_KEY".
 */
const nonPlaceholderApiKey = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0 && s !== "YOUR_API_KEY");

/**
 * Arbitrary for generating random MCP config objects that already have
 * a konductor entry with a non-placeholder API key.
 */
const existingMcpConfigWithKey = nonPlaceholderApiKey.map((key) => ({
  mcpServers: {
    konductor: {
      url: "http://localhost:3010/sse",
      headers: {
        Authorization: `Bearer ${key}`,
        "X-Konductor-User": "testuser",
      },
      autoApprove: ["register_session"],
    },
  },
}));

describe("Property 3: API key handling preserves existing non-placeholder keys", () => {
  /**
   * **Feature: konductor-npx-installer, Property 3: API key handling preserves existing non-placeholder keys**
   * **Validates: Requirements 3.3**
   *
   * For any existing MCP config with a non-placeholder API key,
   * running installGlobal without --api-key preserves the existing key.
   */
  it("preserves existing non-placeholder API keys when no --api-key provided", async () => {
    await fc.assert(
      fc.asyncProperty(existingMcpConfigWithKey, async (config) => {
        // Setup: create a temp home directory with the existing config
        const fakeHome = mkdtempSync(join(tmpdir(), "prop3-"));
        os.homedir.mockReturnValue(fakeHome);

        try {
          // Write the existing config
          const mcpDir = join(fakeHome, ".kiro", "settings");
          mkdirSync(mcpDir, { recursive: true });
          writeFileSync(
            join(mcpDir, "mcp.json"),
            JSON.stringify(config, null, 2),
            "utf-8"
          );

          // Create a minimal bundle dir with required files
          const bundleDir = mkdtempSync(join(tmpdir(), "bundle-"));
          mkdirSync(join(bundleDir, "kiro", "steering"), { recursive: true });
          mkdirSync(join(bundleDir, "agent", "rules"), { recursive: true });
          writeFileSync(
            join(bundleDir, "kiro", "steering", "konductor-collision-awareness.md"),
            "# steering",
            "utf-8"
          );
          writeFileSync(
            join(bundleDir, "agent", "rules", "konductor-collision-awareness.md"),
            "# agent",
            "utf-8"
          );

          // Extract the original key
          const originalKey =
            config.mcpServers.konductor.headers.Authorization.replace(
              /^Bearer\s+/,
              ""
            );

          // Run installGlobal WITHOUT --api-key
          await installGlobal(bundleDir, undefined);

          // Read back the config
          const result = JSON.parse(
            readFileSync(join(mcpDir, "mcp.json"), "utf-8")
          );
          const resultKey =
            result.mcpServers.konductor.headers.Authorization.replace(
              /^Bearer\s+/,
              ""
            );

          // The key must be preserved
          expect(resultKey).toBe(originalKey);

          // Cleanup
          rmSync(bundleDir, { recursive: true, force: true });
        } finally {
          rmSync(fakeHome, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Arbitrary for generating random MCP configs — some with konductor entry, some without.
 */
const mcpConfigWithOrWithoutKonductor = fc.oneof(
  // Config WITH konductor entry
  fc.record({
    mcpServers: fc.record({
      konductor: fc.constant({
        url: "http://localhost:3010/sse",
        headers: { Authorization: "Bearer somekey" },
      }),
    }),
  }),
  // Config WITHOUT konductor entry (but with other servers)
  fc
    .string({ minLength: 1, maxLength: 20 })
    .filter((s) => s !== "konductor" && /^[a-zA-Z]/.test(s))
    .map((name) => ({
      mcpServers: {
        [name]: { url: "http://example.com" },
      },
    })),
  // Config with empty mcpServers
  fc.constant({ mcpServers: {} }),
  // Config with no mcpServers at all
  fc.constant({})
);

describe("Property 4: Auto-mode correctly detects global config presence", () => {
  /**
   * **Feature: konductor-npx-installer, Property 4: Auto-mode correctly detects global config presence**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For any MCP config, detectMode returns "workspace" if konductor entry exists,
   * "both" otherwise.
   */
  it("returns workspace when konductor entry exists, both otherwise", () => {
    fc.assert(
      fc.property(mcpConfigWithOrWithoutKonductor, (config) => {
        const fakeHome = mkdtempSync(join(tmpdir(), "prop4-"));
        os.homedir.mockReturnValue(fakeHome);

        try {
          const mcpDir = join(fakeHome, ".kiro", "settings");
          mkdirSync(mcpDir, { recursive: true });
          writeFileSync(
            join(mcpDir, "mcp.json"),
            JSON.stringify(config, null, 2),
            "utf-8"
          );

          const mode = detectMode();
          const hasKonductor =
            config.mcpServers && config.mcpServers.konductor;

          if (hasKonductor) {
            expect(mode).toBe("workspace");
          } else {
            expect(mode).toBe("both");
          }
        } finally {
          rmSync(fakeHome, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });

  it("returns both when no mcp.json exists", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "prop4-nofile-"));
    os.homedir.mockReturnValue(fakeHome);

    try {
      const mode = detectMode();
      expect(mode).toBe("both");
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

// Import installWorkspace (needs platform mock already in place)
const { installWorkspace } = await import("./installer.mjs");

/**
 * Arbitrary for generating random .konductor-watcher.env file contents.
 */
const envFileContent = fc
  .array(
    fc.oneof(
      fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[A-Z_][A-Z_0-9]*$/.test(s)),
        fc.string({ minLength: 0, maxLength: 50 })
      ).map(([k, v]) => `${k}=${v}`),
      fc.string({ minLength: 1, maxLength: 60 }).map((s) => `# ${s}`)
    ),
    { minLength: 1, maxLength: 15 }
  )
  .map((lines) => lines.join("\n") + "\n");

describe("Property 5: Env file preservation", () => {
  /**
   * **Feature: konductor-npx-installer, Property 5: Env file preservation**
   * **Validates: Requirements 5.2**
   *
   * For any workspace with an existing .konductor-watcher.env file,
   * running installWorkspace does not modify or overwrite that file.
   */
  it("preserves existing .konductor-watcher.env contents", async () => {
    // Get the real bundle path for deployment
    const bundleDir = resolve(
      new URL(".", import.meta.url).pathname,
      "..",
      "bundle"
    );

    await fc.assert(
      fc.asyncProperty(envFileContent, async (content) => {
        const fakeWorkspace = mkdtempSync(join(tmpdir(), "prop5-"));

        try {
          // Write the existing env file
          writeFileSync(
            join(fakeWorkspace, ".konductor-watcher.env"),
            content,
            "utf-8"
          );

          // Run workspace setup
          await installWorkspace(bundleDir, fakeWorkspace, "0.1.0");

          // Read back the env file
          const result = readFileSync(
            join(fakeWorkspace, ".konductor-watcher.env"),
            "utf-8"
          );

          // Content must be unchanged
          expect(result).toBe(content);
        } finally {
          rmSync(fakeWorkspace, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });
});
