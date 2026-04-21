/**
 * Integration tests for collaboration request REST endpoints.
 *
 * Tests:
 * - GET /api/repo/:repoName/collab-requests — list non-expired requests
 * - POST /api/collab-requests/:requestId/respond — accept or decline
 * - SSE event emission on respond
 *
 * Requirements: 7.1–7.4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { CollabRequestStore } from "./collab-request-store.js";
import type { CollabRequest } from "./collab-request-store.js";
import { BatonEventEmitter } from "./baton-event-emitter.js";
import type { BatonEvent } from "./baton-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDeps() {
  const collabStore = new CollabRequestStore(() => 1800, () => true);
  const batonEventEmitter = new BatonEventEmitter();
  return { collabStore, batonEventEmitter };
}

/**
 * Minimal HTTP server that handles collab request REST routes.
 * Mirrors the logic from index.ts without the full server stack.
 */
function createCollabApiServer(deps: ReturnType<typeof createTestDeps>) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    // GET /api/repo/:repoName/collab-requests
    const listMatch = url.pathname.match(/^\/api\/repo\/([^/]+)\/collab-requests$/);
    if (req.method === "GET" && listMatch) {
      const repoName = listMatch[1];
      const repo = `org/${repoName}`;
      const requests = deps.collabStore.listForRepo(repo);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ requests }));
      return;
    }

    // POST /api/collab-requests/:requestId/respond
    const respondMatch = url.pathname.match(/^\/api\/collab-requests\/([^/]+)\/respond$/);
    if (req.method === "POST" && respondMatch) {
      const requestId = respondMatch[1];

      const request = deps.collabStore.getById(requestId);
      if (!request) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Collaboration request not found: ${requestId}` }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      let body: { action?: string };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }

      if (body.action !== "accept" && body.action !== "decline") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: 'Invalid action. Must be "accept" or "decline".' }));
        return;
      }

      try {
        const updated = deps.collabStore.respond(requestId, body.action);
        if (deps.batonEventEmitter) {
          deps.batonEventEmitter.emit({ type: "collab_request_update", repo: updated.repo, data: updated });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ requestId: updated.requestId, status: updated.status }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  return server;
}

async function startServer(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Collab Request REST Endpoints", () => {
  let server: Server;
  let port: number;
  let deps: ReturnType<typeof createTestDeps>;

  beforeEach(async () => {
    deps = createTestDeps();
    server = createCollabApiServer(deps);
    port = await startServer(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ── GET /api/repo/:repoName/collab-requests ─────────────────────

  describe("GET /api/repo/:repoName/collab-requests", () => {
    it("returns empty array when no requests exist (Req 7.1)", async () => {
      const res = await fetch(`http://localhost:${port}/api/repo/my-app/collab-requests`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.requests).toEqual([]);
    });

    it("returns non-expired requests for the repo (Req 7.1)", async () => {
      deps.collabStore.create("alice", "bob", "org/my-app", "main", ["src/index.ts"], "collision_course" as any);
      deps.collabStore.create("carol", "dave", "org/my-app", "feat", ["src/utils.ts"], "merge_hell" as any);

      const res = await fetch(`http://localhost:${port}/api/repo/my-app/collab-requests`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.requests).toHaveLength(2);
    });

    it("does not return requests from other repos", async () => {
      deps.collabStore.create("alice", "bob", "org/my-app", "main", ["src/index.ts"], "collision_course" as any);
      deps.collabStore.create("carol", "dave", "org/other-repo", "main", ["src/utils.ts"], "collision_course" as any);

      const res = await fetch(`http://localhost:${port}/api/repo/my-app/collab-requests`);
      const data: any = await res.json();
      expect(data.requests).toHaveLength(1);
      expect(data.requests[0].initiator).toBe("alice");
    });
  });

  // ── POST /api/collab-requests/:requestId/respond ────────────────

  describe("POST /api/collab-requests/:requestId/respond", () => {
    it("accepts a pending request (Req 7.3)", async () => {
      const req = deps.collabStore.create("alice", "bob", "org/my-app", "main", ["src/index.ts"], "collision_course" as any);

      const res = await fetch(`http://localhost:${port}/api/collab-requests/${req.requestId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.status).toBe("accepted");
    });

    it("declines a pending request (Req 7.3)", async () => {
      const req = deps.collabStore.create("alice", "bob", "org/my-app", "main", ["src/index.ts"], "collision_course" as any);

      const res = await fetch(`http://localhost:${port}/api/collab-requests/${req.requestId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.status).toBe("declined");
    });

    it("returns 404 for non-existent request", async () => {
      const res = await fetch(`http://localhost:${port}/api/collab-requests/nonexistent-id/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      expect(res.status).toBe(404);
      const data: any = await res.json();
      expect(data.error).toContain("not found");
    });

    it("returns 400 for invalid action", async () => {
      const req = deps.collabStore.create("alice", "bob", "org/my-app", "main", ["src/index.ts"], "collision_course" as any);

      const res = await fetch(`http://localhost:${port}/api/collab-requests/${req.requestId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "maybe" }),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("Invalid action");
    });

    it("returns 400 for invalid JSON body", async () => {
      const req = deps.collabStore.create("alice", "bob", "org/my-app", "main", ["src/index.ts"], "collision_course" as any);

      const res = await fetch(`http://localhost:${port}/api/collab-requests/${req.requestId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when responding to non-pending request", async () => {
      const req = deps.collabStore.create("alice", "bob", "org/my-app", "main", ["src/index.ts"], "collision_course" as any);
      deps.collabStore.respond(req.requestId, "accept");

      const res = await fetch(`http://localhost:${port}/api/collab-requests/${req.requestId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("Cannot respond");
    });

    it("emits collab_request_update SSE event on respond (Req 7.4)", async () => {
      const events: BatonEvent[] = [];
      const unsub = deps.batonEventEmitter.subscribe("org/my-app", (event) => {
        events.push(event);
      });

      const req = deps.collabStore.create("alice", "bob", "org/my-app", "main", ["src/index.ts"], "collision_course" as any);

      await fetch(`http://localhost:${port}/api/collab-requests/${req.requestId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });

      const collabEvents = events.filter((e) => e.type === "collab_request_update");
      expect(collabEvents).toHaveLength(1);
      expect(collabEvents[0].repo).toBe("org/my-app");
      expect((collabEvents[0].data as CollabRequest).status).toBe("accepted");

      unsub();
    });
  });
});
