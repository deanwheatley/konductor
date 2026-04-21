/**
 * Unit tests for collaboration request MCP tools.
 *
 * Tests: create_collab_request, list_collab_requests, respond_collab_request, share_link
 * Requirements: 3.2–3.7, 11.1, 11.2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rm, mkdir } from "node:fs/promises";

import { buildMcpServer } from "./index.js";
import { SessionManager } from "./session-manager.js";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { SummaryFormatter } from "./summary-formatter.js";
import { ConfigManager } from "./config-manager.js";
import { PersistenceStore } from "./persistence-store.js";
import { CollabRequestStore } from "./collab-request-store.js";
import { BatonEventEmitter } from "./baton-event-emitter.js";
import type { BatonEvent } from "./baton-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: { content: { type: string; text: string }[]; isError?: boolean }) {
  return JSON.parse((result as any).content[0].text);
}

async function makeTempDir(): Promise<string> {
  const dir = join(tmpdir(), `konductor-collab-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Collaboration request MCP tools", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;
  let collabStore: CollabRequestStore;
  let emittedEvents: BatonEvent[];
  let batonEventEmitter: BatonEventEmitter;

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

    collabStore = new CollabRequestStore(
      () => 1800,
      () => true,
    );

    batonEventEmitter = new BatonEventEmitter();
    emittedEvents = [];
    batonEventEmitter.subscribe("org/repo", (event) => {
      emittedEvents.push(event);
    });

    const mcp = buildMcpServer({
      sessionManager,
      collisionEvaluator,
      summaryFormatter,
      configManager,
      collabRequestStore: collabStore,
      batonEventEmitter,
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

  // ── create_collab_request ───────────────────────────────────────

  describe("create_collab_request", () => {
    it("creates a pending request and returns requestId + status", async () => {
      const result = await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });

      const data = parseResult(result as any);
      expect(data.requestId).toBeTruthy();
      expect(data.status).toBe("pending");
    });

    it("emits collab_request_update SSE event", async () => {
      await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });

      const collabEvents = emittedEvents.filter((e) => e.type === "collab_request_update");
      expect(collabEvents).toHaveLength(1);
      expect(collabEvents[0].repo).toBe("org/repo");
    });

    it("rejects invalid repo format", async () => {
      const result = await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "bad-repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });

      const data = parseResult(result as any);
      expect(data.error).toContain("owner/repo");
    });

    it("returns error when collab is disabled", async () => {
      // Create a new setup with disabled store
      const disabledStore = new CollabRequestStore(() => 1800, () => false);
      const tempDir2 = await makeTempDir();
      const configManager2 = new ConfigManager();
      await configManager2.load(join(tempDir2, "konductor.yaml"));
      const persistenceStore2 = new PersistenceStore(join(tempDir2, "sessions.json"));
      const sessionManager2 = new SessionManager(persistenceStore2, () => 300000);
      await sessionManager2.init();

      const mcp2 = buildMcpServer({
        sessionManager: sessionManager2,
        collisionEvaluator: new CollisionEvaluator(),
        summaryFormatter: new SummaryFormatter(),
        configManager: configManager2,
        collabRequestStore: disabledStore,
      });

      const [ct, st] = InMemoryTransport.createLinkedPair();
      await mcp2.connect(st);
      const client2 = new Client({ name: "test-client-2", version: "1.0.0" });
      await client2.connect(ct);

      try {
        const result = await client2.callTool({
          name: "create_collab_request",
          arguments: {
            initiator: "alice",
            recipient: "bob",
            repo: "org/repo",
            branch: "main",
            files: ["src/index.ts"],
            collisionState: "collision_course",
          },
        });

        const data = parseResult(result as any);
        expect(data.error).toContain("disabled");
      } finally {
        await client2.close();
        await mcp2.close();
        await rm(tempDir2, { recursive: true, force: true });
      }
    });

    it("deduplicates same initiator→recipient+repo", async () => {
      const r1 = await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });
      const r2 = await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });

      const d1 = parseResult(r1 as any);
      const d2 = parseResult(r2 as any);
      expect(d1.requestId).toBe(d2.requestId);
    });
  });

  // ── list_collab_requests ────────────────────────────────────────

  describe("list_collab_requests", () => {
    it("returns requests for a user", async () => {
      await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });

      const result = await client.callTool({
        name: "list_collab_requests",
        arguments: { userId: "alice" },
      });

      const data = parseResult(result as any);
      expect(data.requests).toHaveLength(1);
      expect(data.requests[0].initiator).toBe("alice");
    });

    it("returns empty array for user with no requests", async () => {
      const result = await client.callTool({
        name: "list_collab_requests",
        arguments: { userId: "nobody" },
      });

      const data = parseResult(result as any);
      expect(data.requests).toHaveLength(0);
    });
  });

  // ── respond_collab_request ──────────────────────────────────────

  describe("respond_collab_request", () => {
    it("accepts a pending request", async () => {
      const createResult = await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });
      const { requestId } = parseResult(createResult as any);

      const result = await client.callTool({
        name: "respond_collab_request",
        arguments: { requestId, action: "accept" },
      });

      const data = parseResult(result as any);
      expect(data.status).toBe("accepted");
    });

    it("declines a pending request", async () => {
      const createResult = await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });
      const { requestId } = parseResult(createResult as any);

      const result = await client.callTool({
        name: "respond_collab_request",
        arguments: { requestId, action: "decline" },
      });

      const data = parseResult(result as any);
      expect(data.status).toBe("declined");
    });

    it("emits SSE event on respond", async () => {
      const createResult = await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });
      const { requestId } = parseResult(createResult as any);

      emittedEvents = []; // Clear create event
      await client.callTool({
        name: "respond_collab_request",
        arguments: { requestId, action: "accept" },
      });

      const collabEvents = emittedEvents.filter((e) => e.type === "collab_request_update");
      expect(collabEvents).toHaveLength(1);
    });

    it("returns error for non-existent request", async () => {
      const result = await client.callTool({
        name: "respond_collab_request",
        arguments: { requestId: "bad-id", action: "accept" },
      });

      const data = parseResult(result as any);
      expect(data.error).toContain("not found");
    });

    it("returns error for non-pending request", async () => {
      const createResult = await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });
      const { requestId } = parseResult(createResult as any);

      await client.callTool({
        name: "respond_collab_request",
        arguments: { requestId, action: "accept" },
      });

      const result = await client.callTool({
        name: "respond_collab_request",
        arguments: { requestId, action: "decline" },
      });

      const data = parseResult(result as any);
      expect(data.error).toContain("Cannot respond");
    });
  });

  // ── share_link ──────────────────────────────────────────────────

  describe("share_link", () => {
    it("attaches a valid Live Share link", async () => {
      const createResult = await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });
      const { requestId } = parseResult(createResult as any);

      await client.callTool({
        name: "respond_collab_request",
        arguments: { requestId, action: "accept" },
      });

      const result = await client.callTool({
        name: "share_link",
        arguments: {
          requestId,
          shareLink: "https://prod.liveshare.vsengsaas.visualstudio.com/join?abc123",
        },
      });

      const data = parseResult(result as any);
      expect(data.status).toBe("link_shared");
      expect(data.shareLink).toContain("liveshare");
    });

    it("rejects invalid Live Share URL", async () => {
      const createResult = await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });
      const { requestId } = parseResult(createResult as any);

      await client.callTool({
        name: "respond_collab_request",
        arguments: { requestId, action: "accept" },
      });

      let result: any;
      try {
        result = await client.callTool({
          name: "share_link",
          arguments: {
            requestId,
            shareLink: "https://example.com/some-random-link",
          },
        });
      } catch (err: any) {
        // MCP SDK may throw for isError responses
        expect(err.message || String(err)).toContain("Invalid Live Share URL");
        return;
      }

      // If it didn't throw, check the content
      const text = result.content[0].text;
      expect(text).toContain("Invalid Live Share URL");
    });

    it("emits SSE event on share_link", async () => {
      const createResult = await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });
      const { requestId } = parseResult(createResult as any);

      await client.callTool({
        name: "respond_collab_request",
        arguments: { requestId, action: "accept" },
      });

      emittedEvents = []; // Clear previous events
      await client.callTool({
        name: "share_link",
        arguments: {
          requestId,
          shareLink: "https://prod.liveshare.vsengsaas.visualstudio.com/join?abc",
        },
      });

      const collabEvents = emittedEvents.filter((e) => e.type === "collab_request_update");
      expect(collabEvents).toHaveLength(1);
    });

    it("returns error for non-accepted request", async () => {
      const createResult = await client.callTool({
        name: "create_collab_request",
        arguments: {
          initiator: "alice",
          recipient: "bob",
          repo: "org/repo",
          branch: "main",
          files: ["src/index.ts"],
          collisionState: "collision_course",
        },
      });
      const { requestId } = parseResult(createResult as any);

      const result = await client.callTool({
        name: "share_link",
        arguments: {
          requestId,
          shareLink: "https://prod.liveshare.vsengsaas.visualstudio.com/join?abc",
        },
      });

      const data = parseResult(result as any);
      expect(data.error).toContain("Cannot attach link");
    });
  });

  // ── Tools not registered when store is absent ───────────────────

  describe("tools not registered without collabRequestStore", () => {
    it("does not register collab tools when store is not provided", async () => {
      const tempDir2 = await makeTempDir();
      const configManager2 = new ConfigManager();
      await configManager2.load(join(tempDir2, "konductor.yaml"));
      const persistenceStore2 = new PersistenceStore(join(tempDir2, "sessions.json"));
      const sessionManager2 = new SessionManager(persistenceStore2, () => 300000);
      await sessionManager2.init();

      const mcp2 = buildMcpServer({
        sessionManager: sessionManager2,
        collisionEvaluator: new CollisionEvaluator(),
        summaryFormatter: new SummaryFormatter(),
        configManager: configManager2,
        // No collabRequestStore
      });

      const [ct, st] = InMemoryTransport.createLinkedPair();
      await mcp2.connect(st);
      const client2 = new Client({ name: "test-client-2", version: "1.0.0" });
      await client2.connect(ct);

      try {
        const tools = await client2.listTools();
        const toolNames = tools.tools.map((t: any) => t.name);
        expect(toolNames).not.toContain("create_collab_request");
        expect(toolNames).not.toContain("list_collab_requests");
        expect(toolNames).not.toContain("respond_collab_request");
        expect(toolNames).not.toContain("share_link");
      } finally {
        await client2.close();
        await mcp2.close();
        await rm(tempDir2, { recursive: true, force: true });
      }
    });
  });
});
