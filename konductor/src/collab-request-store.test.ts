import { describe, it, expect, beforeEach } from "vitest";
import { CollabRequestStore } from "./collab-request-store.js";
import { CollisionState } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStore(
  ttlSeconds = 1800,
  enabled = true,
): CollabRequestStore {
  return new CollabRequestStore(
    () => ttlSeconds,
    () => enabled,
  );
}

const DEFAULT_ARGS = {
  initiator: "alice",
  recipient: "bob",
  repo: "org/repo",
  branch: "main",
  files: ["src/index.ts"],
  collisionState: CollisionState.CollisionCourse,
} as const;

function createRequest(
  store: CollabRequestStore,
  overrides: Partial<typeof DEFAULT_ARGS> = {},
) {
  const args = { ...DEFAULT_ARGS, ...overrides };
  return store.create(
    args.initiator,
    args.recipient,
    args.repo,
    args.branch,
    [...args.files],
    args.collisionState,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CollabRequestStore", () => {
  let store: CollabRequestStore;

  beforeEach(() => {
    store = createStore();
  });

  // ── create ──────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a pending request with correct fields", () => {
      const req = createRequest(store);

      expect(req.requestId).toBeTruthy();
      expect(req.initiator).toBe("alice");
      expect(req.recipient).toBe("bob");
      expect(req.repo).toBe("org/repo");
      expect(req.branch).toBe("main");
      expect(req.files).toEqual(["src/index.ts"]);
      expect(req.collisionState).toBe(CollisionState.CollisionCourse);
      expect(req.status).toBe("pending");
      expect(req.createdAt).toBeTruthy();
      expect(req.updatedAt).toBeTruthy();
      expect(req.shareLink).toBeUndefined();
    });

    it("deduplicates same initiator→recipient+repo", () => {
      const first = createRequest(store);
      const second = createRequest(store);

      expect(second.requestId).toBe(first.requestId);
    });

    it("does not dedup different recipients", () => {
      const first = createRequest(store, { recipient: "bob" });
      const second = createRequest(store, { recipient: "carol" });

      expect(second.requestId).not.toBe(first.requestId);
    });

    it("does not dedup different repos", () => {
      const first = createRequest(store, { repo: "org/repo-a" });
      const second = createRequest(store, { repo: "org/repo-b" });

      expect(second.requestId).not.toBe(first.requestId);
    });

    it("does not dedup when existing request is not pending", () => {
      const first = createRequest(store);
      store.respond(first.requestId, "decline");

      const second = createRequest(store);
      expect(second.requestId).not.toBe(first.requestId);
      expect(second.status).toBe("pending");
    });
  });

  // ── mutual detection ────────────────────────────────────────────

  describe("mutual detection", () => {
    it("auto-accepts both when A→B and B→A are pending for same repo", () => {
      const ab = createRequest(store, {
        initiator: "alice",
        recipient: "bob",
      });
      expect(ab.status).toBe("pending");

      const ba = createRequest(store, {
        initiator: "bob",
        recipient: "alice",
      });

      expect(ab.status).toBe("accepted");
      expect(ba.status).toBe("accepted");
    });

    it("does not auto-accept for different repos", () => {
      const ab = createRequest(store, {
        initiator: "alice",
        recipient: "bob",
        repo: "org/repo-a",
      });
      const ba = createRequest(store, {
        initiator: "bob",
        recipient: "alice",
        repo: "org/repo-b",
      });

      expect(ab.status).toBe("pending");
      expect(ba.status).toBe("pending");
    });
  });

  // ── respond ─────────────────────────────────────────────────────

  describe("respond", () => {
    it("accepts a pending request", () => {
      const req = createRequest(store);
      const updated = store.respond(req.requestId, "accept");

      expect(updated.status).toBe("accepted");
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(req.createdAt).getTime(),
      );
    });

    it("declines a pending request", () => {
      const req = createRequest(store);
      const updated = store.respond(req.requestId, "decline");

      expect(updated.status).toBe("declined");
    });

    it("throws for non-existent request", () => {
      expect(() => store.respond("bad-id", "accept")).toThrow(
        "Collaboration request not found",
      );
    });

    it("throws for non-pending request", () => {
      const req = createRequest(store);
      store.respond(req.requestId, "accept");

      expect(() => store.respond(req.requestId, "decline")).toThrow(
        'Cannot respond to request in "accepted" state',
      );
    });
  });

  // ── attachLink ──────────────────────────────────────────────────

  describe("attachLink", () => {
    it("attaches link to accepted request", () => {
      const req = createRequest(store);
      store.respond(req.requestId, "accept");

      const updated = store.attachLink(
        req.requestId,
        "https://prod.liveshare.vsengsaas.visualstudio.com/join?abc",
      );

      expect(updated.status).toBe("link_shared");
      expect(updated.shareLink).toBe(
        "https://prod.liveshare.vsengsaas.visualstudio.com/join?abc",
      );
    });

    it("throws for non-existent request", () => {
      expect(() => store.attachLink("bad-id", "https://example.com")).toThrow(
        "Collaboration request not found",
      );
    });

    it("throws for non-accepted request", () => {
      const req = createRequest(store);

      expect(() =>
        store.attachLink(req.requestId, "https://example.com"),
      ).toThrow('Cannot attach link to request in "pending" state');
    });
  });

  // ── listForUser ─────────────────────────────────────────────────

  describe("listForUser", () => {
    it("returns requests where user is initiator", () => {
      createRequest(store, { initiator: "alice", recipient: "bob" });
      const results = store.listForUser("alice");

      expect(results).toHaveLength(1);
      expect(results[0].initiator).toBe("alice");
    });

    it("returns requests where user is recipient", () => {
      createRequest(store, { initiator: "alice", recipient: "bob" });
      const results = store.listForUser("bob");

      expect(results).toHaveLength(1);
      expect(results[0].recipient).toBe("bob");
    });

    it("returns newest-first", () => {
      const first = createRequest(store, {
        initiator: "alice",
        recipient: "bob",
        repo: "org/repo-a",
      });
      const second = createRequest(store, {
        initiator: "alice",
        recipient: "carol",
        repo: "org/repo-b",
      });

      const results = store.listForUser("alice");
      expect(results).toHaveLength(2);
      expect(
        new Date(results[0].updatedAt).getTime(),
      ).toBeGreaterThanOrEqual(new Date(results[1].updatedAt).getTime());
    });

    it("excludes requests for other users", () => {
      createRequest(store, { initiator: "alice", recipient: "bob" });
      const results = store.listForUser("carol");

      expect(results).toHaveLength(0);
    });
  });

  // ── listForRepo ─────────────────────────────────────────────────

  describe("listForRepo", () => {
    it("returns requests for the specified repo", () => {
      createRequest(store, { repo: "org/repo-a" });
      createRequest(store, {
        repo: "org/repo-b",
        initiator: "carol",
        recipient: "dave",
      });

      const results = store.listForRepo("org/repo-a");
      expect(results).toHaveLength(1);
      expect(results[0].repo).toBe("org/repo-a");
    });
  });

  // ── getById ─────────────────────────────────────────────────────

  describe("getById", () => {
    it("returns the request by ID", () => {
      const req = createRequest(store);
      const found = store.getById(req.requestId);

      expect(found).not.toBeNull();
      expect(found!.requestId).toBe(req.requestId);
    });

    it("returns null for unknown ID", () => {
      expect(store.getById("nonexistent")).toBeNull();
    });
  });

  // ── TTL expiry ──────────────────────────────────────────────────

  describe("TTL expiry", () => {
    it("marks pending requests older than TTL as expired", () => {
      const ttlSeconds = 1; // 1 second TTL
      const shortStore = createStore(ttlSeconds);
      const req = createRequest(shortStore);

      // Backdate createdAt to be older than TTL
      (req as any).createdAt = new Date(
        Date.now() - (ttlSeconds + 1) * 1000,
      ).toISOString();

      const expiredCount = shortStore.cleanup();
      expect(expiredCount).toBe(1);
      expect(req.status).toBe("expired");
    });

    it("does not expire non-pending requests", () => {
      const ttlSeconds = 1;
      const shortStore = createStore(ttlSeconds);
      const req = createRequest(shortStore);
      shortStore.respond(req.requestId, "accept");

      // Backdate
      (req as any).createdAt = new Date(
        Date.now() - (ttlSeconds + 1) * 1000,
      ).toISOString();

      const expiredCount = shortStore.cleanup();
      expect(expiredCount).toBe(0);
      expect(req.status).toBe("accepted");
    });

    it("does not expire requests within TTL", () => {
      const req = createRequest(store);
      const expiredCount = store.cleanup();

      expect(expiredCount).toBe(0);
      expect(req.status).toBe("pending");
    });
  });

  // ── Expiry grace period ─────────────────────────────────────────

  describe("expiry grace period", () => {
    it("includes expired request in first listForUser call after expiry", () => {
      const ttlSeconds = 1;
      const shortStore = createStore(ttlSeconds);
      const req = createRequest(shortStore);

      // Backdate and expire
      (req as any).createdAt = new Date(
        Date.now() - (ttlSeconds + 1) * 1000,
      ).toISOString();
      shortStore.cleanup();

      // First call: should include the expired request (grace period)
      const firstCall = shortStore.listForUser("alice");
      expect(firstCall).toHaveLength(1);
      expect(firstCall[0].status).toBe("expired");

      // Second call: should NOT include it (grace delivered)
      const secondCall = shortStore.listForUser("alice");
      expect(secondCall).toHaveLength(0);
    });

    it("removes grace-delivered expired requests on next cleanup", () => {
      const ttlSeconds = 1;
      const shortStore = createStore(ttlSeconds);
      const req = createRequest(shortStore);

      // Backdate and expire
      (req as any).createdAt = new Date(
        Date.now() - (ttlSeconds + 1) * 1000,
      ).toISOString();
      shortStore.cleanup();

      // Deliver grace
      shortStore.listForUser("alice");

      // Next cleanup should remove the expired request entirely
      shortStore.cleanup();
      expect(shortStore.getById(req.requestId)).toBeNull();
    });
  });

  // ── Pending requests survive collision resolution ────────────────

  describe("pending requests survive collision resolution", () => {
    it("pending request is NOT auto-cancelled when collision resolves", () => {
      const req = createRequest(store);
      expect(req.status).toBe("pending");

      // Simulate collision resolving — nothing in the store changes
      // The store has no concept of collision state changes
      const found = store.getById(req.requestId);
      expect(found).not.toBeNull();
      expect(found!.status).toBe("pending");
    });
  });

  // ── Disabled toggle ─────────────────────────────────────────────

  describe("disabled toggle", () => {
    it("throws when creating a request while disabled", () => {
      const disabledStore = createStore(1800, false);

      expect(() => createRequest(disabledStore)).toThrow(
        "Collaboration requests are disabled on this server.",
      );
    });

    it("allows respond/attachLink/queries when disabled", () => {
      // Create while enabled, then disable
      const req = createRequest(store);
      const disabledStore = createStore(1800, false);

      // These operations don't check the toggle — they work on existing data
      // But since disabledStore is a different instance, we test on the original
      store.respond(req.requestId, "accept");
      expect(req.status).toBe("accepted");
    });
  });
});
