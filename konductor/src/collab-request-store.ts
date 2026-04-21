/**
 * CollabRequestStore — In-memory store for collaboration requests.
 *
 * Manages the lifecycle of Live Share collaboration requests:
 * pending → accepted / declined / expired / link_shared.
 *
 * Features:
 * - Deduplication: same initiator→recipient+repo returns existing pending request
 * - Mutual detection: A→B and B→A both pending auto-accept both
 * - TTL expiry with grace period for one additional check-in cycle
 * - Master toggle via KONDUCTOR_COLLAB_ENABLED
 *
 * Requirements: 3.1–3.11, 11.1, 11.2
 */

import { randomUUID } from "node:crypto";
import type { CollisionState } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollabRequestStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "link_shared";

export interface CollabRequest {
  requestId: string;
  initiator: string;
  recipient: string;
  repo: string;
  branch: string;
  files: string[];
  collisionState: CollisionState;
  shareLink?: string;
  status: CollabRequestStatus;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class CollabRequestStore {
  private requests: Map<string, CollabRequest> = new Map();
  /** Track requestIds that have been included in a grace-period response after expiry. */
  private graceDelivered: Set<string> = new Set();
  private readonly getTtlSeconds: () => number;
  private readonly isEnabled: () => boolean;

  /**
   * @param getTtlSeconds  Returns the TTL in seconds (default: 1800 = 30 min).
   * @param isEnabled      Returns whether the collab feature is enabled.
   */
  constructor(
    getTtlSeconds: () => number = () =>
      parseInt(process.env.KONDUCTOR_COLLAB_REQUEST_TTL ?? "1800", 10),
    isEnabled: () => boolean = () =>
      (process.env.KONDUCTOR_COLLAB_ENABLED ?? "true") !== "false",
  ) {
    this.getTtlSeconds = getTtlSeconds;
    this.isEnabled = isEnabled;
  }

  // ── Create ────────────────────────────────────────────────────────

  /**
   * Create a new collaboration request.
   *
   * - Throws when the feature is disabled (Req 11.2).
   * - Deduplicates: returns existing pending request for same initiator→recipient+repo (Req 3.8).
   * - Mutual detection: auto-accepts both if A→B and B→A are pending (Req 3.9).
   */
  create(
    initiator: string,
    recipient: string,
    repo: string,
    branch: string,
    files: string[],
    collisionState: CollisionState,
  ): CollabRequest {
    if (!this.isEnabled()) {
      throw new Error("Collaboration requests are disabled on this server.");
    }

    // Dedup: return existing pending request for same initiator→recipient+repo (Req 3.8)
    for (const req of this.requests.values()) {
      if (
        req.initiator === initiator &&
        req.recipient === recipient &&
        req.repo === repo &&
        req.status === "pending"
      ) {
        return req;
      }
    }

    const now = new Date().toISOString();
    const request: CollabRequest = {
      requestId: randomUUID(),
      initiator,
      recipient,
      repo,
      branch,
      files,
      collisionState,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    this.requests.set(request.requestId, request);

    // Mutual detection: if B→A is also pending for the same repo, auto-accept both (Req 3.9)
    this.detectAndAutoAcceptMutual(request);

    return request;
  }

  // ── Respond ───────────────────────────────────────────────────────

  /**
   * Accept or decline a collaboration request (Req 3.5).
   */
  respond(requestId: string, action: "accept" | "decline"): CollabRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Collaboration request not found: ${requestId}`);
    }
    if (request.status !== "pending") {
      throw new Error(
        `Cannot respond to request in "${request.status}" state.`,
      );
    }

    request.status = action === "accept" ? "accepted" : "declined";
    request.updatedAt = new Date().toISOString();
    return request;
  }

  // ── Attach Link ───────────────────────────────────────────────────

  /**
   * Attach a Live Share join URI to an accepted request (Req 3.6).
   */
  attachLink(requestId: string, shareLink: string): CollabRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Collaboration request not found: ${requestId}`);
    }
    if (request.status !== "accepted") {
      throw new Error(
        `Cannot attach link to request in "${request.status}" state. Request must be accepted first.`,
      );
    }

    request.shareLink = shareLink;
    request.status = "link_shared";
    request.updatedAt = new Date().toISOString();
    return request;
  }

  // ── Queries ───────────────────────────────────────────────────────

  /**
   * List non-expired requests where user is initiator or recipient, newest-first (Req 3.4).
   * Includes expired requests in grace period (one additional cycle after expiry, Req 3.10).
   */
  listForUser(userId: string): CollabRequest[] {
    const results: CollabRequest[] = [];

    for (const req of this.requests.values()) {
      if (req.initiator !== userId && req.recipient !== userId) continue;

      if (req.status === "expired") {
        // Grace period: include if not yet delivered (Req 3.10)
        if (!this.graceDelivered.has(req.requestId)) {
          this.graceDelivered.add(req.requestId);
          results.push(req);
        }
        continue;
      }

      results.push(req);
    }

    // Sort newest-first by updatedAt
    results.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return results;
  }

  /**
   * List non-expired requests for a repo (Req 3.4).
   * Includes expired requests in grace period.
   */
  listForRepo(repo: string): CollabRequest[] {
    const results: CollabRequest[] = [];

    for (const req of this.requests.values()) {
      if (req.repo !== repo) continue;

      if (req.status === "expired") {
        if (!this.graceDelivered.has(req.requestId)) {
          this.graceDelivered.add(req.requestId);
          results.push(req);
        }
        continue;
      }

      results.push(req);
    }

    results.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return results;
  }

  /**
   * Get a single request by ID, or null if not found.
   */
  getById(requestId: string): CollabRequest | null {
    return this.requests.get(requestId) ?? null;
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  /**
   * Mark pending requests older than TTL as expired (Req 3.3).
   * Remove expired requests that have already been through the grace period.
   * Returns the number of requests marked expired.
   */
  cleanup(): number {
    const ttlMs = this.getTtlSeconds() * 1000;
    const cutoff = Date.now() - ttlMs;
    let expiredCount = 0;

    // First pass: remove expired requests that have been grace-delivered
    for (const [id, req] of this.requests) {
      if (req.status === "expired" && this.graceDelivered.has(id)) {
        this.requests.delete(id);
        this.graceDelivered.delete(id);
      }
    }

    // Second pass: mark pending requests older than TTL as expired
    for (const req of this.requests.values()) {
      if (
        req.status === "pending" &&
        new Date(req.createdAt).getTime() <= cutoff
      ) {
        req.status = "expired";
        req.updatedAt = new Date().toISOString();
        expiredCount++;
      }
    }

    return expiredCount;
  }

  // ── Internal ──────────────────────────────────────────────────────

  /**
   * Detect mutual pending requests and auto-accept both (Req 3.9).
   * Called after creating a new request.
   */
  private detectAndAutoAcceptMutual(newRequest: CollabRequest): void {
    for (const existing of this.requests.values()) {
      if (
        existing.requestId === newRequest.requestId ||
        existing.status !== "pending"
      ) {
        continue;
      }

      // Check if this is the reverse direction: existing is B→A, new is A→B
      if (
        existing.initiator === newRequest.recipient &&
        existing.recipient === newRequest.initiator &&
        existing.repo === newRequest.repo
      ) {
        const now = new Date().toISOString();
        existing.status = "accepted";
        existing.updatedAt = now;
        newRequest.status = "accepted";
        newRequest.updatedAt = now;
        return; // Only one mutual pair possible
      }
    }
  }
}
