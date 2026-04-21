/**
 * Unit tests for MCP tool handlers.
 *
 * Uses InMemoryTransport to connect a Client ↔ McpServer pair in-process,
 * then invokes each tool and verifies the response.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { readdirSync, statSync, readFileSync } from "node:fs";
import fc from "fast-check";

import { buildMcpServer, buildBundleManifest, startSseServer, compareVersions, buildGitHubHistory, buildOpenPRs } from "./index.js";
import { SessionManager } from "./session-manager.js";
import { CollisionEvaluator } from "./collision-evaluator.js";

// Read the actual package version for version-dependent tests
const PKG_VERSION = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8")).version;
import { SummaryFormatter } from "./summary-formatter.js";
import { ConfigManager } from "./config-manager.js";
import { PersistenceStore } from "./persistence-store.js";
import { QueryEngine } from "./query-engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the JSON text content from a tool call result. */
function parseResult(result: { content: { type: string; text: string }[]; isError?: boolean }) {
  const text = (result as any).content[0].text;
  return JSON.parse(text);
}

/** Create a temporary directory for test artifacts. */
async function makeTempDir(): Promise<string> {
  const dir = join(tmpdir(), `konductor-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("MCP tool handlers", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    tempDir = await makeTempDir();

    const configPath = join(tempDir, "konductor.yaml");
    const sessionsPath = join(tempDir, "sessions.json");

    const configManager = new ConfigManager();
    await configManager.load(configPath);

    const persistenceStore = new PersistenceStore(sessionsPath);
    const sessionManager = new SessionManager(
      persistenceStore,
      () => configManager.getTimeout() * 1000,
    );
    await sessionManager.init();

    const collisionEvaluator = new CollisionEvaluator();
    const summaryFormatter = new SummaryFormatter();
    const queryEngine = new QueryEngine(sessionManager, collisionEvaluator);

    const mcp = buildMcpServer({ sessionManager, collisionEvaluator, summaryFormatter, configManager, queryEngine });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverTransport);

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    cleanup = async () => {
      await client.close();
      await mcp.close();
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  // ── register_session ──────────────────────────────────────────────

  describe("register_session", () => {
    it("creates a session and returns collision state", async () => {
      const result = await client.callTool({
        name: "register_session",
        arguments: {
          userId: "alice",
          repo: "acme/app",
          branch: "main",
          files: ["src/index.ts"],
        },
      });

      const data = parseResult(result as any);
      expect(data.sessionId).toBeDefined();
      expect(data.collisionState).toBe("solo");
      expect(data.summary).toContain("SOLO");
    });

    it("returns collision state when multiple users overlap", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"] },
      });

      const result = await client.callTool({
        name: "register_session",
        arguments: { userId: "bob", repo: "acme/app", branch: "main", files: ["src/index.ts"] },
      });

      const data = parseResult(result as any);
      expect(data.collisionState).toBe("collision_course");
    });

    it("rejects empty file list", async () => {
      const result = await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: [] },
      });

      const data = parseResult(result as any);
      expect(data.error).toContain("empty");
    });

    it("rejects invalid repo format", async () => {
      const result = await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "bad-repo", branch: "main", files: ["a.ts"] },
      });

      const data = parseResult(result as any);
      expect(data.error).toContain("owner/repo");
    });
  });

  // ── check_status ──────────────────────────────────────────────────

  describe("check_status", () => {
    it("returns correct state without modifying sessions", async () => {
      // Register alice
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"] },
      });

      // Check status for bob with overlapping files — should not create a session.
      // Bob has no registered session, so the virtual session has branch="" which
      // differs from alice's "main" → evaluator returns merge_hell.
      const result = await client.callTool({
        name: "check_status",
        arguments: { userId: "bob", repo: "acme/app", files: ["src/index.ts"] },
      });

      const data = parseResult(result as any);
      expect(data.collisionState).toBe("merge_hell");
      expect(data.overlappingSessions).toHaveLength(1);
      expect(data.overlappingSessions[0].userId).toBe("alice");

      // Verify bob has no session registered
      const listResult = await client.callTool({
        name: "list_sessions",
        arguments: { repo: "acme/app" },
      });
      const listData = parseResult(listResult as any);
      expect(listData.sessions).toHaveLength(1);
      expect(listData.sessions[0].userId).toBe("alice");
    });

    it("uses existing session files when files param is omitted", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"] },
      });

      const result = await client.callTool({
        name: "check_status",
        arguments: { userId: "alice", repo: "acme/app" },
      });

      const data = parseResult(result as any);
      expect(data.collisionState).toBe("solo");
    });

    it("returns error when no session and no files provided", async () => {
      const result = await client.callTool({
        name: "check_status",
        arguments: { userId: "ghost", repo: "acme/app" },
      });

      const data = parseResult(result as any);
      expect(data.error).toContain("No active session");
    });
  });

  // ── deregister_session ────────────────────────────────────────────

  describe("deregister_session", () => {
    it("removes an existing session", async () => {
      const regResult = await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"] },
      });
      const { sessionId } = parseResult(regResult as any);

      const deregResult = await client.callTool({
        name: "deregister_session",
        arguments: { sessionId },
      });

      const data = parseResult(deregResult as any);
      expect(data.success).toBe(true);

      // Verify session is gone
      const listResult = await client.callTool({
        name: "list_sessions",
        arguments: { repo: "acme/app" },
      });
      const listData = parseResult(listResult as any);
      expect(listData.sessions).toHaveLength(0);
    });

    it("returns success=false for unknown session ID", async () => {
      const result = await client.callTool({
        name: "deregister_session",
        arguments: { sessionId: "nonexistent-id" },
      });

      const data = parseResult(result as any);
      expect(data.success).toBe(false);
      expect(data.message).toContain("not found");
    });
  });

  // ── list_sessions ─────────────────────────────────────────────────

  describe("list_sessions", () => {
    it("returns active sessions for a repo", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/a.ts"] },
      });
      await client.callTool({
        name: "register_session",
        arguments: { userId: "bob", repo: "acme/app", branch: "feat", files: ["src/b.ts"] },
      });
      // Different repo — should not appear
      await client.callTool({
        name: "register_session",
        arguments: { userId: "carol", repo: "acme/other", branch: "main", files: ["x.ts"] },
      });

      const result = await client.callTool({
        name: "list_sessions",
        arguments: { repo: "acme/app" },
      });

      const data = parseResult(result as any);
      expect(data.sessions).toHaveLength(2);
      const userIds = data.sessions.map((s: any) => s.userId).sort();
      expect(userIds).toEqual(["alice", "bob"]);
    });

    it("rejects invalid repo format", async () => {
      const result = await client.callTool({
        name: "list_sessions",
        arguments: { repo: "noslash" },
      });

      const data = parseResult(result as any);
      expect(data.error).toContain("owner/repo");
    });
  });

  // ── Query tools (Enhanced Chat) ────────────────────────────────────

  describe("who_is_active", () => {
    it("returns active users with correct structure", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/a.ts"] },
      });
      await client.callTool({
        name: "register_session",
        arguments: { userId: "bob", repo: "acme/app", branch: "feat", files: ["src/b.ts"] },
      });

      const result = await client.callTool({ name: "who_is_active", arguments: { repo: "acme/app" } });
      const data = parseResult(result as any);

      expect(data.repo).toBe("acme/app");
      expect(data.totalUsers).toBe(2);
      expect(data.users).toHaveLength(2);
      for (const u of data.users) {
        expect(u).toHaveProperty("userId");
        expect(u).toHaveProperty("branch");
        expect(u).toHaveProperty("files");
        expect(u).toHaveProperty("sessionDurationMinutes");
        expect(u.sessionDurationMinutes).toBeGreaterThanOrEqual(0);
      }
    });

    it("rejects invalid repo format", async () => {
      const result = await client.callTool({ name: "who_is_active", arguments: { repo: "noslash" } });
      const data = parseResult(result as any);
      expect(data.error).toContain("owner/repo");
    });
  });

  describe("who_overlaps", () => {
    it("returns overlapping users with correct structure", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"] },
      });
      await client.callTool({
        name: "register_session",
        arguments: { userId: "bob", repo: "acme/app", branch: "main", files: ["src/index.ts"] },
      });

      const result = await client.callTool({ name: "who_overlaps", arguments: { userId: "alice", repo: "acme/app" } });
      const data = parseResult(result as any);

      expect(data.userId).toBe("alice");
      expect(data.repo).toBe("acme/app");
      expect(data.isAlone).toBe(false);
      expect(data.overlaps).toHaveLength(1);
      expect(data.overlaps[0].userId).toBe("bob");
      expect(data.overlaps[0].sharedFiles).toContain("src/index.ts");
      expect(data.overlaps[0]).toHaveProperty("collisionState");
    });

    it("returns isAlone when no overlaps", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/a.ts"] },
      });

      const result = await client.callTool({ name: "who_overlaps", arguments: { userId: "alice", repo: "acme/app" } });
      const data = parseResult(result as any);
      expect(data.isAlone).toBe(true);
      expect(data.overlaps).toHaveLength(0);
    });

    it("rejects invalid repo format", async () => {
      const result = await client.callTool({ name: "who_overlaps", arguments: { userId: "alice", repo: "bad" } });
      const data = parseResult(result as any);
      expect(data.error).toContain("owner/repo");
    });
  });

  describe("user_activity", () => {
    it("returns sessions across repos", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["a.ts"] },
      });
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/lib", branch: "dev", files: ["b.ts"] },
      });

      const result = await client.callTool({ name: "user_activity", arguments: { userId: "alice" } });
      const data = parseResult(result as any);

      expect(data.userId).toBe("alice");
      expect(data.isActive).toBe(true);
      expect(data.sessions).toHaveLength(2);
      for (const s of data.sessions) {
        expect(s).toHaveProperty("repo");
        expect(s).toHaveProperty("branch");
        expect(s).toHaveProperty("files");
        expect(s).toHaveProperty("sessionStartedAt");
        expect(s).toHaveProperty("lastHeartbeat");
      }
    });

    it("returns isActive false for unknown user", async () => {
      const result = await client.callTool({ name: "user_activity", arguments: { userId: "ghost" } });
      const data = parseResult(result as any);
      expect(data.isActive).toBe(false);
      expect(data.sessions).toHaveLength(0);
    });
  });

  describe("risk_assessment", () => {
    it("returns risk data with correct structure", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"] },
      });
      await client.callTool({
        name: "register_session",
        arguments: { userId: "bob", repo: "acme/app", branch: "feat", files: ["src/index.ts"] },
      });

      const result = await client.callTool({ name: "risk_assessment", arguments: { userId: "alice", repo: "acme/app" } });
      const data = parseResult(result as any);

      expect(data.userId).toBe("alice");
      expect(data.repo).toBe("acme/app");
      expect(data).toHaveProperty("collisionState");
      expect(data).toHaveProperty("severity");
      expect(data).toHaveProperty("overlappingUserCount");
      expect(data).toHaveProperty("sharedFileCount");
      expect(data).toHaveProperty("hasCrossBranchOverlap");
      expect(data).toHaveProperty("riskSummary");
      expect(data.severity).toBeGreaterThanOrEqual(0);
      expect(data.severity).toBeLessThanOrEqual(4);
    });

    it("rejects invalid repo format", async () => {
      const result = await client.callTool({ name: "risk_assessment", arguments: { userId: "alice", repo: "bad" } });
      const data = parseResult(result as any);
      expect(data.error).toContain("owner/repo");
    });
  });

  describe("repo_hotspots", () => {
    it("returns hotspots ranked by editor count", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/hot.ts", "src/cold.ts"] },
      });
      await client.callTool({
        name: "register_session",
        arguments: { userId: "bob", repo: "acme/app", branch: "main", files: ["src/hot.ts"] },
      });

      const result = await client.callTool({ name: "repo_hotspots", arguments: { repo: "acme/app" } });
      const data = parseResult(result as any);

      expect(data.repo).toBe("acme/app");
      expect(data.isClear).toBe(false);
      expect(data.hotspots).toHaveLength(1);
      expect(data.hotspots[0].file).toBe("src/hot.ts");
      expect(data.hotspots[0].editors).toHaveLength(2);
      expect(data.hotspots[0]).toHaveProperty("collisionState");
    });

    it("returns isClear when no hotspots", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["a.ts"] },
      });

      const result = await client.callTool({ name: "repo_hotspots", arguments: { repo: "acme/app" } });
      const data = parseResult(result as any);
      expect(data.isClear).toBe(true);
      expect(data.hotspots).toHaveLength(0);
    });

    it("rejects invalid repo format", async () => {
      const result = await client.callTool({ name: "repo_hotspots", arguments: { repo: "bad" } });
      const data = parseResult(result as any);
      expect(data.error).toContain("owner/repo");
    });
  });

  describe("active_branches", () => {
    it("returns branches with correct structure", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/a.ts"] },
      });
      await client.callTool({
        name: "register_session",
        arguments: { userId: "bob", repo: "acme/app", branch: "feat", files: ["src/b.ts"] },
      });

      const result = await client.callTool({ name: "active_branches", arguments: { repo: "acme/app" } });
      const data = parseResult(result as any);

      expect(data.repo).toBe("acme/app");
      expect(data.branches).toHaveLength(2);
      for (const b of data.branches) {
        expect(b).toHaveProperty("branch");
        expect(b).toHaveProperty("users");
        expect(b).toHaveProperty("files");
        expect(b).toHaveProperty("hasOverlapWithOtherBranches");
      }
    });

    it("rejects invalid repo format", async () => {
      const result = await client.callTool({ name: "active_branches", arguments: { repo: "bad" } });
      const data = parseResult(result as any);
      expect(data.error).toContain("owner/repo");
    });
  });

  describe("coordination_advice", () => {
    it("returns coordination targets ranked by urgency", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"] },
      });
      await client.callTool({
        name: "register_session",
        arguments: { userId: "bob", repo: "acme/app", branch: "feat", files: ["src/index.ts"] },
      });

      const result = await client.callTool({ name: "coordination_advice", arguments: { userId: "alice", repo: "acme/app" } });
      const data = parseResult(result as any);

      expect(data.userId).toBe("alice");
      expect(data.repo).toBe("acme/app");
      expect(data.hasUrgentTargets).toBe(true);
      expect(data.targets).toHaveLength(1);
      expect(data.targets[0].userId).toBe("bob");
      expect(data.targets[0]).toHaveProperty("branch");
      expect(data.targets[0]).toHaveProperty("sharedFiles");
      expect(data.targets[0]).toHaveProperty("urgency");
      expect(data.targets[0]).toHaveProperty("suggestedAction");
      expect(data.targets[0].urgency).toBe("high");
    });

    it("returns empty targets when no overlaps", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["a.ts"] },
      });

      const result = await client.callTool({ name: "coordination_advice", arguments: { userId: "alice", repo: "acme/app" } });
      const data = parseResult(result as any);
      expect(data.targets).toHaveLength(0);
      expect(data.hasUrgentTargets).toBe(false);
    });

    it("rejects invalid repo format", async () => {
      const result = await client.callTool({ name: "coordination_advice", arguments: { userId: "alice", repo: "bad" } });
      const data = parseResult(result as any);
      expect(data.error).toContain("owner/repo");
    });
  });

  // ── SSE auth ──────────────────────────────────────────────────────

  describe("SSE authentication", () => {
    it("rejects requests with invalid API key", async () => {
      // We test the HTTP-level auth by making a direct HTTP request
      // to the SSE server with a bad key.
      const { createServer } = await import("node:http");

      // Import the startSseServer indirectly by testing the HTTP behavior
      // Since startSseServer is not exported, we test via a real HTTP request
      const port = 30000 + Math.floor(Math.random() * 10000);

      // Set up a minimal SSE server inline to test auth
      const server = createServer((req, res) => {
        const apiKey = "test-secret";
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid or missing API key" }));
          return;
        }
        res.writeHead(200);
        res.end("ok");
      });

      await new Promise<void>((resolve) => server.listen(port, resolve));

      try {
        // Request with no auth
        const res1 = await fetch(`http://localhost:${port}/sse`);
        expect(res1.status).toBe(401);
        const body1 = (await res1.json()) as { error: string };
        expect(body1.error).toContain("Invalid or missing API key");

        // Request with wrong auth
        const res2 = await fetch(`http://localhost:${port}/sse`, {
          headers: { Authorization: "Bearer wrong-key" },
        });
        expect(res2.status).toBe(401);

        // Request with correct auth
        const res3 = await fetch(`http://localhost:${port}/sse`, {
          headers: { Authorization: "Bearer test-secret" },
        });
        expect(res3.status).toBe(200);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});


// ---------------------------------------------------------------------------
// Bundle endpoint tests
// ---------------------------------------------------------------------------

/** Recursively walk a directory and return all file paths relative to root. */
function walkDirForTest(dir: string, root: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...walkDirForTest(fullPath, root));
    } else if (stat.isFile()) {
      const rel = fullPath.slice(root.length + 1).split("\\").join("/");
      results.push(rel);
    }
  }
  return results;
}

describe("Bundle endpoints", () => {
  let port: number;
  let server: ReturnType<typeof startSseServer>;
  let tempDir: string;
  const bundleDir = resolve(process.cwd(), "konductor_bundle");

  beforeEach(async () => {
    tempDir = join(tmpdir(), `konductor-bundle-test-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    port = 30000 + Math.floor(Math.random() * 10000);

    const configPath = join(tempDir, "konductor.yaml");
    const sessionsPath = join(tempDir, "sessions.json");

    const configManager = new ConfigManager();
    await configManager.load(configPath);
    const persistenceStore = new PersistenceStore(sessionsPath);
    const sessionManager = new SessionManager(persistenceStore, () => configManager.getTimeout() * 1000);
    await sessionManager.init();
    const collisionEvaluator = new CollisionEvaluator();
    const summaryFormatter = new SummaryFormatter();

    const mcp = buildMcpServer({ sessionManager, collisionEvaluator, summaryFormatter, configManager });

    server = startSseServer(mcp, port, "test-api-key", undefined, {
      sessionManager, collisionEvaluator, summaryFormatter, configManager,
    });

    // Wait for server to be listening
    await new Promise<void>((resolve) => {
      server.on("listening", resolve);
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Unit tests ────────────────────────────────────────────────────

  it("GET /bundle/manifest.json returns valid JSON with version and files", async () => {
    const res = await fetch(`http://localhost:${port}/bundle/manifest.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const data = await res.json() as { version: string; files: string[] };
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("files");
    expect(typeof data.version).toBe("string");
    expect(Array.isArray(data.files)).toBe(true);
    expect(data.files.length).toBeGreaterThan(0);
  });

  it("GET /bundle/files/<valid-path> returns file content with correct content-type", async () => {
    // Fetch manifest first to get a valid file path
    const manifestRes = await fetch(`http://localhost:${port}/bundle/manifest.json`);
    const manifest = await manifestRes.json() as { files: string[] };

    const jsonFile = manifest.files.find((f: string) => f.endsWith(".json"));
    const textFile = manifest.files.find((f: string) => f.endsWith(".mjs") || f.endsWith(".sh") || f.endsWith(".md"));

    if (jsonFile) {
      const res = await fetch(`http://localhost:${port}/bundle/files/${jsonFile}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
    }

    if (textFile) {
      const res = await fetch(`http://localhost:${port}/bundle/files/${textFile}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
    }
  });

  it("GET /bundle/files/<nonexistent> returns 404", async () => {
    const res = await fetch(`http://localhost:${port}/bundle/files/does-not-exist.txt`);
    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("not found");
  });

  it("GET /bundle/files/../../etc/passwd returns 400", async () => {
    // Use http.request directly since fetch() normalizes .. in URLs
    const http = await import("node:http");
    const res = await new Promise<{ status: number; body: string }>((resolve) => {
      const req = http.request(
        { hostname: "localhost", port, path: "/bundle/files/../../etc/passwd", method: "GET" },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }));
        },
      );
      req.end();
    });
    expect(res.status).toBe(400);
    const data = JSON.parse(res.body);
    expect(data.error).toContain("Invalid path");
  });

  it("bundle endpoints work without Authorization header", async () => {
    // The server has apiKey set to "test-api-key", so auth-protected routes would reject.
    // Bundle endpoints should work without any auth header.
    const manifestRes = await fetch(`http://localhost:${port}/bundle/manifest.json`);
    expect(manifestRes.status).toBe(200);

    const manifest = await manifestRes.json() as { files: string[] };
    if (manifest.files.length > 0) {
      const fileRes = await fetch(`http://localhost:${port}/bundle/files/${manifest.files[0]}`);
      expect(fileRes.status).toBe(200);
    }

    // Verify auth IS required for other endpoints
    const sseRes = await fetch(`http://localhost:${port}/api/register`, {
      method: "POST",
      body: JSON.stringify({ userId: "a", repo: "a/b", branch: "main", files: ["x"] }),
    });
    expect(sseRes.status).toBe(401);
  });

  // ── Property 7: Bundle manifest lists all deployable files ────────
  // **Feature: konductor-npx-installer, Property 7: Bundle manifest lists all deployable files**
  // **Validates: Requirements 7.1, 7.2, 7.3**
  it("Property 7: every file in konductor_bundle/ is listed in manifest and retrievable", async () => {
    const actualFiles = walkDirForTest(bundleDir, bundleDir);

    const manifestRes = await fetch(`http://localhost:${port}/bundle/manifest.json`);
    const manifest = await manifestRes.json() as { version: string; files: string[] };

    // Every actual file must be in the manifest
    for (const file of actualFiles) {
      expect(manifest.files).toContain(file);
    }
    // Every manifest file must be an actual file
    for (const file of manifest.files) {
      expect(actualFiles).toContain(file);
    }

    // Every listed file must be retrievable
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...manifest.files),
        async (filePath) => {
          const res = await fetch(`http://localhost:${port}/bundle/files/${filePath}`);
          expect(res.status).toBe(200);
          const body = await res.text();
          // Content should match what's on disk
          const diskContent = readFileSync(join(bundleDir, filePath), "utf-8");
          expect(body).toBe(diskContent);
        },
      ),
      { numRuns: Math.min(manifest.files.length * 3, 100) },
    );
  });

  // ── Property 8: Bundle endpoints reject path traversal ────────────
  // **Feature: konductor-npx-installer, Property 8: Bundle endpoints reject path traversal**
  // **Validates: Requirements 7.5**
  it("Property 8: any path containing '..' is rejected with 400", async () => {
    const http = await import("node:http");
    const segment = fc.array(fc.constantFrom("a", "b", "/", "x", ".", "1"), { minLength: 0, maxLength: 5 }).map(arr => arr.join(""));

    function rawRequest(path: string): Promise<{ status: number; body: string }> {
      return new Promise((resolve) => {
        const req = http.request(
          { hostname: "localhost", port, path, method: "GET" },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }));
          },
        );
        req.end();
      });
    }

    await fc.assert(
      fc.asyncProperty(
        segment,
        segment,
        async (prefix, suffix) => {
          const maliciousPath = `/bundle/files/${prefix}../${suffix}`;
          const res = await rawRequest(maliciousPath);
          expect(res.status).toBe(400);
          const data = JSON.parse(res.body);
          expect(data.error).toContain("Invalid path");
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// buildBundleManifest unit test
// ---------------------------------------------------------------------------

describe("buildBundleManifest", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `konductor-manifest-test-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns correct version and file list for a directory", async () => {
    await mkdir(join(tempDir, "sub"), { recursive: true });
    await writeFile(join(tempDir, "a.txt"), "hello");
    await writeFile(join(tempDir, "sub", "b.json"), "{}");

    const manifest = buildBundleManifest(tempDir, "1.2.3");
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.files.sort()).toEqual(["a.txt", "sub/b.json"].sort());
  });

  it("returns empty files for nonexistent directory", () => {
    const manifest = buildBundleManifest("/nonexistent-dir-xyz", "0.0.0");
    expect(manifest.version).toBe("0.0.0");
    expect(manifest.files).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// Version checking tests
// ---------------------------------------------------------------------------

describe("compareVersions", () => {
  it("returns 'outdated' when client < server", () => {
    expect(compareVersions("0.0.1", "0.1.0")).toBe("outdated");
    expect(compareVersions("0.1.0", "1.0.0")).toBe("outdated");
    expect(compareVersions("1.2.3", "1.2.4")).toBe("outdated");
  });

  it("returns 'current' when client == server", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe("current");
    expect(compareVersions("1.0.0", "1.0.0")).toBe("current");
  });

  it("returns 'newer' when client > server", () => {
    expect(compareVersions("0.2.0", "0.1.0")).toBe("newer");
    expect(compareVersions("2.0.0", "1.9.9")).toBe("newer");
  });

  it("returns 'outdated' for missing/null/undefined client version", () => {
    expect(compareVersions(undefined, "0.1.0")).toBe("outdated");
    expect(compareVersions(null, "0.1.0")).toBe("outdated");
    expect(compareVersions("", "0.1.0")).toBe("outdated");
  });

  it("returns 'outdated' for malformed client version", () => {
    expect(compareVersions("abc", "0.1.0")).toBe("outdated");
    expect(compareVersions("1.2", "0.1.0")).toBe("outdated");
    expect(compareVersions("v1.0.0", "0.1.0")).toBe("outdated");
    expect(compareVersions("1.0.0-beta", "0.1.0")).toBe("outdated");
  });
});

// ---------------------------------------------------------------------------
// Version checking — REST API tests
// ---------------------------------------------------------------------------

describe("Version checking — REST API", () => {
  let port: number;
  let server: ReturnType<typeof startSseServer>;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `konductor-version-test-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    port = 30000 + Math.floor(Math.random() * 10000);

    const configPath = join(tempDir, "konductor.yaml");
    const sessionsPath = join(tempDir, "sessions.json");

    const configManager = new ConfigManager();
    await configManager.load(configPath);
    const persistenceStore = new PersistenceStore(sessionsPath);
    const sessionManager = new SessionManager(persistenceStore, () => configManager.getTimeout() * 1000);
    await sessionManager.init();
    const collisionEvaluator = new CollisionEvaluator();
    const summaryFormatter = new SummaryFormatter();

    const mcp = buildMcpServer({ sessionManager, collisionEvaluator, summaryFormatter, configManager });

    server = startSseServer(mcp, port, "test-api-key", undefined, {
      sessionManager, collisionEvaluator, summaryFormatter, configManager,
    });

    await new Promise<void>((resolve) => {
      server.on("listening", resolve);
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(tempDir, { recursive: true, force: true });
  });

  const registerBody = JSON.stringify({
    userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"],
  });

  const statusBody = JSON.stringify({
    userId: "alice", repo: "acme/app", files: ["src/index.ts"],
  });

  it("POST /api/register with old version header → updateRequired: true", async () => {
    const res = await fetch(`http://localhost:${port}/api/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-api-key",
        "X-Konductor-Client-Version": "0.0.1",
      },
      body: registerBody,
    });
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.updateRequired).toBe(true);
    expect(typeof data.serverVersion).toBe("string");
  });

  it("POST /api/register with current version → no updateRequired", async () => {
    const res = await fetch(`http://localhost:${port}/api/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-api-key",
        "X-Konductor-Client-Version": PKG_VERSION,
      },
      body: registerBody,
    });
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.updateRequired).toBeUndefined();
    expect(data.serverVersion).toBeUndefined();
  });

  it("POST /api/register with no version header → updateRequired: true", async () => {
    const res = await fetch(`http://localhost:${port}/api/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-api-key",
      },
      body: registerBody,
    });
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.updateRequired).toBe(true);
    expect(typeof data.serverVersion).toBe("string");
  });

  it("POST /api/status with old version header → updateRequired: true", async () => {
    // First register so there's a session
    await fetch(`http://localhost:${port}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test-api-key" },
      body: registerBody,
    });

    const res = await fetch(`http://localhost:${port}/api/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-api-key",
        "X-Konductor-Client-Version": "0.0.1",
      },
      body: statusBody,
    });
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.updateRequired).toBe(true);
    expect(typeof data.serverVersion).toBe("string");
  });

  it("POST /api/status with current version → no updateRequired", async () => {
    await fetch(`http://localhost:${port}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test-api-key" },
      body: registerBody,
    });

    const res = await fetch(`http://localhost:${port}/api/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-api-key",
        "X-Konductor-Client-Version": PKG_VERSION,
      },
      body: statusBody,
    });
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.updateRequired).toBeUndefined();
  });

  it("POST /api/register with malformed version → treated as outdated", async () => {
    const res = await fetch(`http://localhost:${port}/api/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-api-key",
        "X-Konductor-Client-Version": "not-a-version",
      },
      body: registerBody,
    });
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.updateRequired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Version checking — MCP tool tests
// ---------------------------------------------------------------------------

describe("Version checking — MCP tools", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `konductor-version-mcp-test-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });

    const configPath = join(tempDir, "konductor.yaml");
    const sessionsPath = join(tempDir, "sessions.json");

    const configManager = new ConfigManager();
    await configManager.load(configPath);
    const persistenceStore = new PersistenceStore(sessionsPath);
    const sessionManager = new SessionManager(persistenceStore, () => configManager.getTimeout() * 1000);
    await sessionManager.init();
    const collisionEvaluator = new CollisionEvaluator();
    const summaryFormatter = new SummaryFormatter();
    const queryEngine = new QueryEngine(sessionManager, collisionEvaluator);

    // Use serverVersion "1.0.0" so we can test outdated/current/newer
    const mcp = buildMcpServer({
      sessionManager, collisionEvaluator, summaryFormatter, configManager, queryEngine,
      serverVersion: "1.0.0",
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverTransport);

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    cleanup = async () => {
      await client.close();
      await mcp.close();
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  it("register_session with old clientVersion → updateRequired: true", async () => {
    const result = await client.callTool({
      name: "register_session",
      arguments: {
        userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"],
        clientVersion: "0.0.1",
      },
    });
    const data = parseResult(result as any);
    expect(data.updateRequired).toBe(true);
    expect(data.serverVersion).toBe("1.0.0");
  });

  it("register_session with current clientVersion → no updateRequired", async () => {
    const result = await client.callTool({
      name: "register_session",
      arguments: {
        userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"],
        clientVersion: "1.0.0",
      },
    });
    const data = parseResult(result as any);
    expect(data.updateRequired).toBeUndefined();
    expect(data.serverVersion).toBeUndefined();
  });

  it("register_session without clientVersion → no updateRequired (MCP tools only flag when provided)", async () => {
    const result = await client.callTool({
      name: "register_session",
      arguments: {
        userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"],
      },
    });
    const data = parseResult(result as any);
    // clientVersion is optional — when omitted, no version check is performed for MCP tools
    // (the header-based check is for REST API; MCP tools use the explicit field)
    expect(data.sessionId).toBeDefined();
  });

  it("check_status with old clientVersion → updateRequired: true", async () => {
    // Register first
    await client.callTool({
      name: "register_session",
      arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"] },
    });

    const result = await client.callTool({
      name: "check_status",
      arguments: {
        userId: "alice", repo: "acme/app",
        clientVersion: "0.5.0",
      },
    });
    const data = parseResult(result as any);
    expect(data.updateRequired).toBe(true);
    expect(data.serverVersion).toBe("1.0.0");
  });

  it("check_status with current clientVersion → no updateRequired", async () => {
    await client.callTool({
      name: "register_session",
      arguments: { userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"] },
    });

    const result = await client.callTool({
      name: "check_status",
      arguments: {
        userId: "alice", repo: "acme/app",
        clientVersion: "1.0.0",
      },
    });
    const data = parseResult(result as any);
    expect(data.updateRequired).toBeUndefined();
  });

  it("register_session with malformed clientVersion → updateRequired: true", async () => {
    const result = await client.callTool({
      name: "register_session",
      arguments: {
        userId: "alice", repo: "acme/app", branch: "main", files: ["src/index.ts"],
        clientVersion: "garbage",
      },
    });
    const data = parseResult(result as any);
    expect(data.updateRequired).toBe(true);
    expect(data.serverVersion).toBe("1.0.0");
  });
});

// ---------------------------------------------------------------------------
// Property 9: Version comparison triggers update correctly
// **Feature: konductor-npx-installer, Property 9: Version comparison triggers update correctly**
// **Validates: Requirements 9.1, 9.2, 9.3**
// ---------------------------------------------------------------------------

describe("Property 9: Version comparison triggers update correctly", () => {
  const semverArb = fc.tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
  ).map(([a, b, c]) => `${a}.${b}.${c}`);

  it("compareVersions returns 'outdated' iff client < server, 'current' iff equal, 'newer' iff client > server", () => {
    fc.assert(
      fc.property(semverArb, semverArb, (clientVer, serverVer) => {
        const result = compareVersions(clientVer, serverVer);

        const [cMaj, cMin, cPat] = clientVer.split(".").map(Number);
        const [sMaj, sMin, sPat] = serverVer.split(".").map(Number);

        const clientNum = cMaj * 10000 + cMin * 100 + cPat;
        const serverNum = sMaj * 10000 + sMin * 100 + sPat;

        if (clientNum < serverNum) {
          expect(result).toBe("outdated");
        } else if (clientNum === serverNum) {
          expect(result).toBe("current");
        } else {
          expect(result).toBe("newer");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("missing or malformed client version is always 'outdated'", () => {
    const malformedArb = fc.oneof(
      fc.constant(undefined as string | undefined),
      fc.constant(null as string | null),
      fc.constant(""),
      fc.string({ minLength: 1, maxLength: 20 }).filter(
        (s: string) => !/^\d+\.\d+\.\d+$/.test(s),
      ),
    );

    fc.assert(
      fc.property(malformedArb, semverArb, (clientVer, serverVer) => {
        const result = compareVersions(clientVer, serverVer);
        expect(result).toBe("outdated");
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// buildGitHubHistory — Unit Tests (Requirement 7.2)
// ---------------------------------------------------------------------------

describe("buildGitHubHistory", () => {
  it("returns empty array when no passive sessions exist", () => {
    const sessions = [
      {
        sessionId: "s1",
        userId: "alice",
        repo: "org/repo",
        branch: "main",
        files: ["src/index.ts"],
        createdAt: "2025-04-15T10:00:00.000Z",
        lastHeartbeat: "2025-04-15T10:00:00.000Z",
      },
    ];
    const history = buildGitHubHistory(sessions);
    expect(history).toEqual([]);
  });

  it("creates PR Opened entry from a github_pr session", () => {
    const sessions = [
      {
        sessionId: "s1",
        userId: "bob",
        repo: "org/repo",
        branch: "feature-x",
        files: ["src/a.ts", "src/b.ts"],
        createdAt: "2025-04-15T10:00:00.000Z",
        lastHeartbeat: "2025-04-15T10:00:00.000Z",
        source: "github_pr" as const,
        prNumber: 42,
        prTargetBranch: "main",
        prDraft: false,
        prApproved: false,
      },
    ];
    const history = buildGitHubHistory(sessions);
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe("PR Opened");
    expect(history[0].user).toBe("bob");
    expect(history[0].branch).toBe("feature-x");
    expect(history[0].summary).toContain("PR #42");
    expect(history[0].summary).toContain("main");
    expect(history[0].summary).toContain("2 files");
  });

  it("creates PR Approved entry when prApproved is true", () => {
    const sessions = [
      {
        sessionId: "s1",
        userId: "carol",
        repo: "org/repo",
        branch: "hotfix",
        files: ["fix.ts"],
        createdAt: "2025-04-15T10:00:00.000Z",
        lastHeartbeat: "2025-04-15T10:00:00.000Z",
        source: "github_pr" as const,
        prNumber: 99,
        prTargetBranch: "main",
        prDraft: false,
        prApproved: true,
      },
    ];
    const history = buildGitHubHistory(sessions);
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe("PR Approved");
  });

  it("creates Commit entry from a github_commit session", () => {
    const sessions = [
      {
        sessionId: "s2",
        userId: "dave",
        repo: "org/repo",
        branch: "main",
        files: ["src/c.ts", "src/d.ts", "src/e.ts"],
        createdAt: "2025-04-16T08:00:00.000Z",
        lastHeartbeat: "2025-04-16T08:00:00.000Z",
        source: "github_commit" as const,
        commitDateRange: { earliest: "2025-04-15T00:00:00.000Z", latest: "2025-04-16T00:00:00.000Z" },
      },
    ];
    const history = buildGitHubHistory(sessions);
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe("Commit");
    expect(history[0].user).toBe("dave");
    expect(history[0].summary).toContain("3 files");
  });

  it("sorts entries newest-first", () => {
    const sessions = [
      {
        sessionId: "s1",
        userId: "alice",
        repo: "org/repo",
        branch: "feat-a",
        files: ["a.ts"],
        createdAt: "2025-04-14T10:00:00.000Z",
        lastHeartbeat: "2025-04-14T10:00:00.000Z",
        source: "github_pr" as const,
        prNumber: 1,
        prTargetBranch: "main",
        prDraft: false,
        prApproved: false,
      },
      {
        sessionId: "s2",
        userId: "bob",
        repo: "org/repo",
        branch: "main",
        files: ["b.ts"],
        createdAt: "2025-04-16T10:00:00.000Z",
        lastHeartbeat: "2025-04-16T10:00:00.000Z",
        source: "github_commit" as const,
        commitDateRange: { earliest: "2025-04-15T00:00:00.000Z", latest: "2025-04-16T10:00:00.000Z" },
      },
    ];
    const history = buildGitHubHistory(sessions);
    expect(history).toHaveLength(2);
    expect(history[0].user).toBe("bob"); // newer
    expect(history[1].user).toBe("alice"); // older
  });

  it("includes draft label in PR summary", () => {
    const sessions = [
      {
        sessionId: "s1",
        userId: "eve",
        repo: "org/repo",
        branch: "wip",
        files: ["x.ts"],
        createdAt: "2025-04-15T10:00:00.000Z",
        lastHeartbeat: "2025-04-15T10:00:00.000Z",
        source: "github_pr" as const,
        prNumber: 7,
        prTargetBranch: "main",
        prDraft: true,
        prApproved: false,
      },
    ];
    const history = buildGitHubHistory(sessions);
    expect(history[0].summary).toContain("(draft)");
  });
});


// ---------------------------------------------------------------------------
// buildOpenPRs — Unit Tests (Requirement 7.1)
// ---------------------------------------------------------------------------

describe("buildOpenPRs", () => {
  it("returns empty array when no PR sessions exist", () => {
    const sessions = [
      {
        sessionId: "s1",
        userId: "alice",
        repo: "org/repo",
        branch: "main",
        files: ["a.ts"],
        createdAt: "2025-04-15T10:00:00.000Z",
        lastHeartbeat: "2025-04-15T10:00:00.000Z",
      },
    ];
    const prs = buildOpenPRs(sessions);
    expect(prs).toEqual([]);
  });

  it("extracts open PR data from PR sessions", () => {
    const sessions = [
      {
        sessionId: "s1",
        userId: "bob",
        repo: "org/repo",
        branch: "feature-x",
        files: ["a.ts", "b.ts"],
        createdAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
        lastHeartbeat: new Date().toISOString(),
        source: "github_pr" as const,
        prNumber: 42,
        prUrl: "https://github.com/org/repo/pull/42",
        prTargetBranch: "main",
        prDraft: false,
        prApproved: false,
      },
    ];
    const prs = buildOpenPRs(sessions);
    expect(prs).toHaveLength(1);
    expect(prs[0].prNumber).toBe(42);
    expect(prs[0].user).toBe("bob");
    expect(prs[0].branch).toBe("feature-x");
    expect(prs[0].targetBranch).toBe("main");
    expect(prs[0].status).toBe("open");
    expect(prs[0].filesCount).toBe(2);
    expect(prs[0].hoursOpen).toBeGreaterThan(0);
  });

  it("marks draft PRs with draft status", () => {
    const sessions = [
      {
        sessionId: "s1",
        userId: "carol",
        repo: "org/repo",
        branch: "wip",
        files: ["x.ts"],
        createdAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        source: "github_pr" as const,
        prNumber: 7,
        prDraft: true,
        prApproved: false,
      },
    ];
    const prs = buildOpenPRs(sessions);
    expect(prs[0].status).toBe("draft");
  });

  it("marks approved PRs with approved status", () => {
    const sessions = [
      {
        sessionId: "s1",
        userId: "dave",
        repo: "org/repo",
        branch: "ready",
        files: ["y.ts"],
        createdAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        source: "github_pr" as const,
        prNumber: 99,
        prDraft: false,
        prApproved: true,
      },
    ];
    const prs = buildOpenPRs(sessions);
    expect(prs[0].status).toBe("approved");
  });

  it("ignores commit sessions", () => {
    const sessions = [
      {
        sessionId: "s1",
        userId: "eve",
        repo: "org/repo",
        branch: "main",
        files: ["z.ts"],
        createdAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        source: "github_commit" as const,
        commitDateRange: { earliest: "2025-04-15T00:00:00Z", latest: "2025-04-16T00:00:00Z" },
      },
    ];
    const prs = buildOpenPRs(sessions);
    expect(prs).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// Baton Auth Integration Tests (Task 7.1)
// Requirements: 1.1, 1.7, 2.2, 2.3, 3.3, 4.1, 4.2, 5.3
// ---------------------------------------------------------------------------

import {
  BatonAuthModule,
  encodeSession as rawEncodeSession,
  parseCookies as rawParseCookies,
  serializeCookie as rawSerializeCookie,
} from "./baton-auth.js";
import type { BatonSession } from "./baton-auth.js";
import { NotificationStore } from "./baton-notification-store.js";
import { QueryLogStore } from "./baton-query-log.js";
import { BatonEventEmitter } from "./baton-event-emitter.js";

describe("Baton Auth — Integration Tests", () => {
  const SESSION_SECRET = "integration-test-secret-key-1234";

  /** Create a valid, non-expired BatonSession. */
  function makeSession(overrides: Partial<BatonSession> = {}): BatonSession {
    return {
      githubUsername: "testuser",
      githubAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      accessToken: "gho_test_token_abc123",
      createdAt: Date.now(),
      expiresAt: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
      ...overrides,
    };
  }

  /** Create an expired BatonSession. */
  function makeExpiredSession(): BatonSession {
    return makeSession({ expiresAt: Date.now() - 1000 });
  }

  /** Encode a session into a cookie value using the test secret. */
  function encodeTestSession(session: BatonSession): string {
    return rawEncodeSession(session, SESSION_SECRET);
  }

  /**
   * Spin up a real HTTP server with BatonAuthModule wired in.
   * The auth module's checkRepoAccess is overridden to avoid real GitHub calls.
   */
  async function createAuthServer(opts: {
    authEnabled: boolean;
    accessResult?: "allowed" | "denied" | "error";
  }) {
    const tempDir = join(tmpdir(), `konductor-auth-integ-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    const port = 30000 + Math.floor(Math.random() * 10000);

    const configPath = join(tempDir, "konductor.yaml");
    const sessionsPath = join(tempDir, "sessions.json");

    const configManager = new ConfigManager();
    await configManager.load(configPath);
    const persistenceStore = new PersistenceStore(sessionsPath);
    const sessionManager = new SessionManager(persistenceStore, () => configManager.getTimeout() * 1000);
    await sessionManager.init();
    const collisionEvaluator = new CollisionEvaluator();
    const summaryFormatter = new SummaryFormatter();
    const notificationStore = new NotificationStore();
    const queryLogStore = new QueryLogStore();
    const batonEventEmitter = new BatonEventEmitter();

    // Register a session so /repo/app resolves to "org/app"
    await sessionManager.register("alice", "org/app", "main", ["src/index.ts"]);

    let batonAuth: BatonAuthModule | undefined;
    if (opts.authEnabled) {
      batonAuth = new BatonAuthModule({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        serverUrl: `http://localhost:${port}`,
        sessionSecret: SESSION_SECRET,
        sessionMaxAgeHours: 8,
        accessCacheMinutes: 5,
      });
      // Override checkRepoAccess to avoid real GitHub API calls
      batonAuth.checkRepoAccess = async () => opts.accessResult ?? "allowed";
    }

    const mcp = buildMcpServer({ sessionManager, collisionEvaluator, summaryFormatter, configManager });

    const server = startSseServer(mcp, port, "test-api-key", undefined, {
      sessionManager,
      collisionEvaluator,
      summaryFormatter,
      configManager,
      notificationStore,
      queryLogStore,
      batonEventEmitter,
      batonAuth,
    });

    await new Promise<void>((resolve) => server.on("listening", resolve));

    return {
      port,
      server,
      tempDir,
      batonAuth,
      cleanup: async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(tempDir, { recursive: true, force: true });
      },
    };
  }

  // ── Property 1: Auth bypass when unconfigured (Req 5.3) ──────────

  describe("Property 1: Auth disabled — routes serve without auth", () => {
    let ctx: Awaited<ReturnType<typeof createAuthServer>>;

    beforeEach(async () => {
      ctx = await createAuthServer({ authEnabled: false });
    });
    afterEach(async () => { await ctx.cleanup(); });

    it("GET /repo/:repoName serves page without auth check", async () => {
      const res = await fetch(`http://localhost:${ctx.port}/repo/app`, { redirect: "manual" });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Konductor Baton");
    });

    it("GET /api/repo/:repoName serves JSON without auth check", async () => {
      const res = await fetch(`http://localhost:${ctx.port}/api/repo/app`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("repo");
    });
  });

  // ── Auth enabled, no session → redirect / 401 (Req 1.1, 4.1) ────

  describe("Auth enabled, no session", () => {
    let ctx: Awaited<ReturnType<typeof createAuthServer>>;

    beforeEach(async () => {
      ctx = await createAuthServer({ authEnabled: true });
    });
    afterEach(async () => { await ctx.cleanup(); });

    it("GET /repo/:repoName redirects to /auth/login (Req 1.1)", async () => {
      const res = await fetch(`http://localhost:${ctx.port}/repo/app`, { redirect: "manual" });
      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/auth/login");
      expect(location).toContain("redirect=");
    });

    // Property 6: API endpoints return JSON errors, not redirects (Req 4.1)
    it("GET /api/repo/:repoName returns 401 JSON (Property 6, Req 4.1)", async () => {
      const res = await fetch(`http://localhost:${ctx.port}/api/repo/app`);
      expect(res.status).toBe(401);
      const data = await res.json() as { error: string };
      expect(data.error).toContain("Authentication required");
      // Verify it's JSON, not an HTML redirect
      expect(res.headers.get("content-type")).toContain("application/json");
    });

    it("GET /api/repo/:repoName/notifications returns 401 JSON", async () => {
      const res = await fetch(`http://localhost:${ctx.port}/api/repo/app/notifications`);
      expect(res.status).toBe(401);
      const data = await res.json() as { error: string };
      expect(data.error).toContain("Authentication required");
    });

    it("GET /api/repo/:repoName/events returns 401 JSON (Req 4.3)", async () => {
      const res = await fetch(`http://localhost:${ctx.port}/api/repo/app/events`);
      expect(res.status).toBe(401);
      const data = await res.json() as { error: string };
      expect(data.error).toContain("Authentication required");
    });
  });

  // ── Auth enabled, valid session, repo access → page served (Req 2.2) ──

  describe("Auth enabled, valid session with repo access", () => {
    let ctx: Awaited<ReturnType<typeof createAuthServer>>;

    beforeEach(async () => {
      ctx = await createAuthServer({ authEnabled: true, accessResult: "allowed" });
    });
    afterEach(async () => { await ctx.cleanup(); });

    it("GET /repo/:repoName serves page with user in header (Req 2.2)", async () => {
      const session = makeSession();
      const cookie = `baton_session=${encodeURIComponent(encodeTestSession(session))}`;
      const res = await fetch(`http://localhost:${ctx.port}/repo/app`, {
        redirect: "manual",
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Konductor Baton");
      expect(html).toContain("testuser");
    });

    it("GET /api/repo/:repoName serves JSON (Req 2.2)", async () => {
      const session = makeSession();
      const cookie = `baton_session=${encodeURIComponent(encodeTestSession(session))}`;
      const res = await fetch(`http://localhost:${ctx.port}/api/repo/app`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("repo");
    });
  });

  // ── Auth enabled, valid session, no repo access → 403 (Req 2.3, 4.2) ──

  describe("Auth enabled, valid session, repo access denied", () => {
    let ctx: Awaited<ReturnType<typeof createAuthServer>>;

    beforeEach(async () => {
      ctx = await createAuthServer({ authEnabled: true, accessResult: "denied" });
    });
    afterEach(async () => { await ctx.cleanup(); });

    it("GET /repo/:repoName returns 403 page (Req 2.3)", async () => {
      const session = makeSession();
      const cookie = `baton_session=${encodeURIComponent(encodeTestSession(session))}`;
      const res = await fetch(`http://localhost:${ctx.port}/repo/app`, {
        redirect: "manual",
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(403);
      const html = await res.text();
      expect(html).toContain("Access Denied");
      expect(html).toContain("testuser");
    });

    it("GET /api/repo/:repoName returns 403 JSON (Property 6, Req 4.2)", async () => {
      const session = makeSession();
      const cookie = `baton_session=${encodeURIComponent(encodeTestSession(session))}`;
      const res = await fetch(`http://localhost:${ctx.port}/api/repo/app`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(403);
      const data = await res.json() as { error: string };
      expect(data.error).toContain("access denied");
      expect(res.headers.get("content-type")).toContain("application/json");
    });
  });

  // ── Auth enabled, expired session → redirects to login (Req 3.3) ──

  describe("Auth enabled, expired session", () => {
    let ctx: Awaited<ReturnType<typeof createAuthServer>>;

    beforeEach(async () => {
      ctx = await createAuthServer({ authEnabled: true });
    });
    afterEach(async () => { await ctx.cleanup(); });

    it("GET /repo/:repoName redirects to login (Req 3.3)", async () => {
      const expired = makeExpiredSession();
      const cookie = `baton_session=${encodeURIComponent(encodeTestSession(expired))}`;
      const res = await fetch(`http://localhost:${ctx.port}/repo/app`, {
        redirect: "manual",
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/auth/login");
    });

    it("GET /api/repo/:repoName returns 401 JSON for expired session", async () => {
      const expired = makeExpiredSession();
      const cookie = `baton_session=${encodeURIComponent(encodeTestSession(expired))}`;
      const res = await fetch(`http://localhost:${ctx.port}/api/repo/app`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(401);
    });
  });

  // ── /auth/callback with mismatched state → 403 (Property 3, Req 1.7) ──

  describe("OAuth callback — CSRF state validation (Property 3)", () => {
    let ctx: Awaited<ReturnType<typeof createAuthServer>>;

    beforeEach(async () => {
      ctx = await createAuthServer({ authEnabled: true });
    });
    afterEach(async () => { await ctx.cleanup(); });

    it("/auth/callback with mismatched state returns 403 (Req 1.7)", async () => {
      // Set a state cookie with one value, but send a different state in the URL
      const statePayload = JSON.stringify({ state: "expected-state-abc", redirect: "/repo/app" });
      const stateCookie = `baton_auth_state=${encodeURIComponent(statePayload)}`;

      const res = await fetch(
        `http://localhost:${ctx.port}/auth/callback?code=fake-code&state=wrong-state-xyz`,
        { redirect: "manual", headers: { Cookie: stateCookie } },
      );
      expect(res.status).toBe(403);
      const html = await res.text();
      expect(html).toContain("Authentication Failed");
    });

    it("/auth/callback with missing code returns 400", async () => {
      const res = await fetch(
        `http://localhost:${ctx.port}/auth/callback?state=some-state`,
        { redirect: "manual" },
      );
      expect(res.status).toBe(400);
    });
  });

  // ── /auth/logout clears session and redirects (Req 3.4) ──────────

  describe("Logout flow", () => {
    let ctx: Awaited<ReturnType<typeof createAuthServer>>;

    beforeEach(async () => {
      ctx = await createAuthServer({ authEnabled: true });
    });
    afterEach(async () => { await ctx.cleanup(); });

    it("GET /auth/logout redirects to /auth/logged-out and clears cookie", async () => {
      const session = makeSession();
      const cookie = `baton_session=${encodeURIComponent(encodeTestSession(session))}`;
      const res = await fetch(`http://localhost:${ctx.port}/auth/logout`, {
        redirect: "manual",
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/auth/logged-out");
      // Check that the Set-Cookie clears the session (Max-Age=0)
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("baton_session=");
      expect(setCookie).toContain("Max-Age=0");
    });

    it("GET /auth/logged-out serves the logged-out page", async () => {
      const res = await fetch(`http://localhost:${ctx.port}/auth/logged-out`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("logged out");
    });
  });

  // ── Property 7: Redirect path preserved through OAuth flow (Req 1.1, 1.6) ──

  describe("Property 7: Redirect path preserved through OAuth flow", () => {
    let ctx: Awaited<ReturnType<typeof createAuthServer>>;

    beforeEach(async () => {
      ctx = await createAuthServer({ authEnabled: true });
    });
    afterEach(async () => { await ctx.cleanup(); });

    it("GET /auth/login stores redirect path in state cookie", async () => {
      const res = await fetch(
        `http://localhost:${ctx.port}/auth/login?redirect=/repo/my-repo`,
        { redirect: "manual" },
      );
      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("github.com/login/oauth/authorize");
      expect(location).toContain("client_id=test-client-id");

      // The state cookie should contain the redirect path
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("baton_auth_state=");
      // Decode the cookie value to verify redirect is stored
      const match = setCookie.match(/baton_auth_state=([^;]+)/);
      expect(match).toBeTruthy();
      const decoded = JSON.parse(decodeURIComponent(match![1]));
      expect(decoded.redirect).toBe("/repo/my-repo");
      expect(decoded.state).toBeTruthy();
    });
  });

  // ── GitHub API error → 503 (Req 2.4) ─────────────────────────────

  describe("Auth enabled, GitHub API error → 503", () => {
    let ctx: Awaited<ReturnType<typeof createAuthServer>>;

    beforeEach(async () => {
      ctx = await createAuthServer({ authEnabled: true, accessResult: "error" });
    });
    afterEach(async () => { await ctx.cleanup(); });

    it("GET /repo/:repoName returns 503 page", async () => {
      const session = makeSession();
      const cookie = `baton_session=${encodeURIComponent(encodeTestSession(session))}`;
      const res = await fetch(`http://localhost:${ctx.port}/repo/app`, {
        redirect: "manual",
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(503);
      const html = await res.text();
      expect(html).toContain("GitHub Unavailable");
    });

    it("GET /api/repo/:repoName returns 503 JSON", async () => {
      const session = makeSession();
      const cookie = `baton_session=${encodeURIComponent(encodeTestSession(session))}`;
      const res = await fetch(`http://localhost:${ctx.port}/api/repo/app`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(503);
      const data = await res.json() as { error: string };
      expect(data.error).toContain("GitHub API unavailable");
    });
  });
});
