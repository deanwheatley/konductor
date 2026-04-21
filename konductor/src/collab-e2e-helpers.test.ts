/**
 * Unit tests for the addCollabRequest E2E helper function.
 *
 * Verifies the helper creates requests with correct fields via CollabRequestStore,
 * handles status overrides (accepted, declined, link_shared), and emits SSE events.
 *
 * Requirements: 4.3
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CollabRequestStore } from "./collab-request-store.js";
import { BatonEventEmitter } from "./baton-event-emitter.js";
import { CollisionState } from "./types.js";
import type { CollabRequest } from "./collab-request-store.js";

/**
 * Minimal reproduction of the addCollabRequest helper logic from e2e/helpers.ts.
 * We test the core logic here without needing the full TestContext.
 */
function addCollabRequest(
  store: CollabRequestStore,
  emitter: BatonEventEmitter,
  overrides: Partial<CollabRequest> & { initiator: string; recipient: string },
): CollabRequest {
  const request = store.create(
    overrides.initiator,
    overrides.recipient,
    overrides.repo ?? "acme/webapp",
    overrides.branch ?? "main",
    overrides.files ?? ["src/index.ts"],
    (overrides.collisionState as CollisionState) ?? CollisionState.CollisionCourse,
  );

  if (overrides.status === "accepted" || overrides.status === "link_shared") {
    if (request.status === "pending") {
      store.respond(request.requestId, "accept");
    }
  }
  if (overrides.status === "declined") {
    if (request.status === "pending") {
      store.respond(request.requestId, "decline");
    }
  }
  if (overrides.status === "link_shared" && overrides.shareLink) {
    store.attachLink(request.requestId, overrides.shareLink);
  }

  emitter.emit({
    type: "collab_request_update",
    repo: request.repo,
    data: request,
  });

  return request;
}

describe("addCollabRequest helper", () => {
  let store: CollabRequestStore;
  let emitter: BatonEventEmitter;

  beforeEach(() => {
    store = new CollabRequestStore(() => 1800, () => true);
    emitter = new BatonEventEmitter();
  });

  it("creates a pending request with correct fields", () => {
    const req = addCollabRequest(store, emitter, {
      initiator: "alice",
      recipient: "bob",
      repo: "org/repo",
      branch: "feature/x",
      files: ["src/a.ts", "src/b.ts"],
      collisionState: CollisionState.CollisionCourse,
    });

    expect(req.requestId).toBeTruthy();
    expect(req.initiator).toBe("alice");
    expect(req.recipient).toBe("bob");
    expect(req.repo).toBe("org/repo");
    expect(req.branch).toBe("feature/x");
    expect(req.files).toEqual(["src/a.ts", "src/b.ts"]);
    expect(req.collisionState).toBe(CollisionState.CollisionCourse);
    expect(req.status).toBe("pending");
  });

  it("applies accepted status override", () => {
    const req = addCollabRequest(store, emitter, {
      initiator: "alice",
      recipient: "bob",
      status: "accepted",
    });
    expect(req.status).toBe("accepted");
  });

  it("applies declined status override", () => {
    const req = addCollabRequest(store, emitter, {
      initiator: "carol",
      recipient: "dave",
      status: "declined",
    });
    expect(req.status).toBe("declined");
  });

  it("applies link_shared status with shareLink", () => {
    const req = addCollabRequest(store, emitter, {
      initiator: "eve",
      recipient: "frank",
      status: "link_shared",
      shareLink: "https://prod.liveshare.vsengsaas.visualstudio.com/join?ABC",
    });
    expect(req.status).toBe("link_shared");
    expect(req.shareLink).toBe("https://prod.liveshare.vsengsaas.visualstudio.com/join?ABC");
  });

  it("uses default values when overrides are minimal", () => {
    const req = addCollabRequest(store, emitter, {
      initiator: "alice",
      recipient: "bob",
    });
    expect(req.repo).toBe("acme/webapp");
    expect(req.branch).toBe("main");
    expect(req.files).toEqual(["src/index.ts"]);
    expect(req.collisionState).toBe(CollisionState.CollisionCourse);
  });

  it("emits collab_request_update SSE event", () => {
    const events: unknown[] = [];
    emitter.subscribe("acme/webapp", (evt) => events.push(evt));

    addCollabRequest(store, emitter, {
      initiator: "alice",
      recipient: "bob",
    });

    expect(events.length).toBe(1);
    const evt = events[0] as { type: string; repo: string; data: CollabRequest };
    expect(evt.type).toBe("collab_request_update");
    expect(evt.repo).toBe("acme/webapp");
    expect(evt.data.initiator).toBe("alice");
  });

  it("request is retrievable from store after creation", () => {
    const req = addCollabRequest(store, emitter, {
      initiator: "alice",
      recipient: "bob",
      repo: "org/repo",
    });
    const stored = store.getById(req.requestId);
    expect(stored).not.toBeNull();
    expect(stored!.requestId).toBe(req.requestId);
  });
});
