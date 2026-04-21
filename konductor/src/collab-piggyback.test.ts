/**
 * Unit tests for collaboration request piggyback on check-in responses.
 *
 * Tests: pendingCollabRequests in register_session and check_status responses
 * Requirements: 5.1, 5.5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rm, mkdir } from "node:fs/promises";

import { buildMcpServer, getPendingCollabRequests } from "./index.js";
import { SessionManager } from "./session-manager.js";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { SummaryFormatter } from "./summary-formatter.js";
import { ConfigManager } from "./config-manager.js";
import { PersistenceStore } from "./persistence-store.js";
import { CollabRequestStore } from "./collab-request-store.js";
import { CollisionState } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: { content: { type: string; text: string }[]; isError?: boolean }) {
  return JSON.parse((result as any).content[0].text);
}

async function makeTempDir(): Promise<string> {
  const dir = join(tmpdir(), `konductor-piggyback-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Unit tests for getPendingCollabRequests helper
// ---------------------------------------------------------------------------

describe("getPendingCollabRequests", () => {
  it("returns empty array when store is undefined", () => {
    expect(getPendingCollabRequests(undefined, "alice")).toEqual([]);
  });

  it("returns pending requests where user is recipient", () => {
    const store = new CollabRequestStore(() => 1800, () => true);
    store.create("bob", "alice", "org/repo", "main", ["a.ts"], CollisionState.CollisionCourse);

    const result = getPendingCollabRequests(store, "alice");
    expect(result).toHaveLength(1);
    expect(result[0].recipient).toBe("alice");
    expect(result[0].status).toBe("pending");
  });

  it("returns accepted requests where user is initiator", () => {
    const store = new CollabRequestStore(() => 1800, () => true);
    const req = store.create("alice", "bob", "org/repo", "main", ["a.ts"], CollisionState.CollisionCourse);
    store.respond(req.requestId, "accept");

    const result = getPendingCollabRequests(store, "alice");
    expect(result).toHaveLength(1);
    expect(result[0].initiator).toBe("alice");
    expect(result[0].status).toBe("accepted");
  });

  it("returns declined requests where user is initiator", () => {
    const store = new CollabRequestStore(() => 1800, () => true);
    const req = store.create("alice", "bob", "org/repo", "main", ["a.ts"], CollisionState.CollisionCourse);
    store.respond(req.requestId, "decline");

    const result = getPendingCollabRequests(store, "alice");
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("declined");
  });

  it("returns link_shared requests where user is initiator", () => {
    const store = new CollabRequestStore(() => 1800, () => true);
    const req = store.create("alice", "bob", "org/repo", "main", ["a.ts"], CollisionState.CollisionCourse);
    store.respond(req.requestId, "accept");
    store.attachLink(req.requestId, "https://prod.liveshare.vsengsaas.visualstudio.com/join?abc");

    const result = getPendingCollabRequests(store, "alice");
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("link_shared");
  });

  it("does NOT return pending requests where user is initiator (no action needed)", () => {
    const store = new CollabRequestStore(() => 1800, () => true);
    store.create("alice", "bob", "org/repo", "main", ["a.ts"], CollisionState.CollisionCourse);

    // Alice is the initiator — she doesn't need to see her own pending request
    const result = getPendingCollabRequests(store, "alice");
    expect(result).toHaveLength(0);
  });

  it("does NOT return accepted/declined requests where user is recipient", () => {
    const store = new CollabRequestStore(() => 1800, () => true);
    const req = store.create("bob", "alice", "org/repo", "main", ["a.ts"], CollisionState.CollisionCourse);
    store.respond(req.requestId, "accept");

    // Alice is the recipient who already accepted — no need to see it again
    const result = getPendingCollabRequests(store, "alice");
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: piggyback on MCP tool responses
// ---------------------------------------------------------------------------

describe("Collab piggyback on check-in", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;
  let collabStore: CollabRequestStore;

  beforeEach(async () => {
    tempDir = await makeTempDir();

    const configManager = new ConfigManager();
    await configManager.load(join(tempDir, "konductor.yaml"));

    const persistenceStore = new PersistenceStore(join(tempDir, "sessions.json"));
    const sessionManager = new SessionManager(
      persistenceStore,
      () => configManager.getTimeout() * 1000,
    );
    await sessionManager.init();

    collabStore = new CollabRequestStore(() => 1800, () => true);

    const mcp = buildMcpServer({
      sessionManager,
      collisionEvaluator: new CollisionEvaluator(),
      summaryFormatter: new SummaryFormatter(),
      configManager,
      collabRequestStore: collabStore,
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

  describe("register_session", () => {
    it("includes pendingCollabRequests when recipient has pending requests", async () => {
      // Create a collab request from bob to alice
      collabStore.create("bob", "alice", "org/repo", "main", ["src/index.ts"], CollisionState.CollisionCourse);

      // Alice registers a session
      const result = await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "org/repo", branch: "main", files: ["src/index.ts"] },
      });

      const data = parseResult(result as any);
      expect(data.pendingCollabRequests).toBeDefined();
      expect(data.pendingCollabRequests).toHaveLength(1);
      expect(data.pendingCollabRequests[0].initiator).toBe("bob");
      expect(data.pendingCollabRequests[0].status).toBe("pending");
    });

    it("includes status updates for initiator (accepted)", async () => {
      // Alice creates a request, bob accepts it
      const req = collabStore.create("alice", "bob", "org/repo", "main", ["src/index.ts"], CollisionState.CollisionCourse);
      collabStore.respond(req.requestId, "accept");

      // Alice registers — should see the accepted status update
      const result = await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "org/repo", branch: "main", files: ["src/index.ts"] },
      });

      const data = parseResult(result as any);
      expect(data.pendingCollabRequests).toBeDefined();
      expect(data.pendingCollabRequests).toHaveLength(1);
      expect(data.pendingCollabRequests[0].status).toBe("accepted");
    });

    it("includes status updates for initiator (declined)", async () => {
      const req = collabStore.create("alice", "bob", "org/repo", "main", ["src/index.ts"], CollisionState.CollisionCourse);
      collabStore.respond(req.requestId, "decline");

      const result = await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "org/repo", branch: "main", files: ["src/index.ts"] },
      });

      const data = parseResult(result as any);
      expect(data.pendingCollabRequests).toHaveLength(1);
      expect(data.pendingCollabRequests[0].status).toBe("declined");
    });

    it("omits pendingCollabRequests when none exist", async () => {
      const result = await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "org/repo", branch: "main", files: ["src/index.ts"] },
      });

      const data = parseResult(result as any);
      expect(data.pendingCollabRequests).toBeUndefined();
    });
  });

  describe("check_status", () => {
    it("includes pendingCollabRequests when recipient has pending requests", async () => {
      // Register alice first so check_status has a session
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "org/repo", branch: "main", files: ["src/index.ts"] },
      });

      // Create a collab request from bob to alice
      collabStore.create("bob", "alice", "org/repo", "main", ["src/index.ts"], CollisionState.CollisionCourse);

      // Alice checks status
      const result = await client.callTool({
        name: "check_status",
        arguments: { userId: "alice", repo: "org/repo" },
      });

      const data = parseResult(result as any);
      expect(data.pendingCollabRequests).toBeDefined();
      expect(data.pendingCollabRequests).toHaveLength(1);
      expect(data.pendingCollabRequests[0].initiator).toBe("bob");
    });

    it("omits pendingCollabRequests when none exist", async () => {
      await client.callTool({
        name: "register_session",
        arguments: { userId: "alice", repo: "org/repo", branch: "main", files: ["src/index.ts"] },
      });

      const result = await client.callTool({
        name: "check_status",
        arguments: { userId: "alice", repo: "org/repo" },
      });

      const data = parseResult(result as any);
      expect(data.pendingCollabRequests).toBeUndefined();
    });
  });
});
