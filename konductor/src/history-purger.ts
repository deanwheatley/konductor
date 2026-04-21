/**
 * HistoryPurger — Periodic purge of expired sessions.
 *
 * Requirements: 3.1–3.5
 */

import type { ISessionHistoryStore } from "./session-history-types.js";
import type { KonductorLogger } from "./logger.js";

export class HistoryPurger {
  private timer: ReturnType<typeof setInterval> | null = null;
  private retentionDays: number;
  private intervalHours: number;

  constructor(
    private readonly store: ISessionHistoryStore,
    private readonly logger: KonductorLogger | undefined,
    retentionDays = 30,
    intervalHours = 6,
  ) {
    this.retentionDays = retentionDays;
    this.intervalHours = intervalHours;
  }

  start(): void {
    // Run immediately
    this.purge();
    // Schedule periodic
    this.timer = setInterval(() => this.purge(), this.intervalHours * 60 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  updateConfig(retentionDays: number, intervalHours: number): void {
    this.retentionDays = retentionDays;
    this.intervalHours = intervalHours;
    // Restart timer with new interval
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  private async purge(): Promise<void> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    try {
      const count = await this.store.purgeOlderThan(cutoff);
      if (this.logger) {
        this.logger.logStaleCleanup(count, this.retentionDays * 24 * 60 * 60);
      }
    } catch {
      // Never crash the server
    }
  }
}
