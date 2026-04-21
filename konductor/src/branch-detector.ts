/**
 * BranchDetector — Detects git branch changes on every poll cycle.
 *
 * Extracted from konductor-watcher.mjs for testability.
 * The watcher calls refreshBranch() at the start of every poll interval.
 * When the branch changes, pending files are cleared and the new branch
 * is used in subsequent registrations.
 *
 * Requirements: 7.1, 7.2, 7.3
 */

export interface BranchDetectorEvents {
  onBranchChanged?: (oldBranch: string, newBranch: string) => void;
}

export interface BranchDetectorOptions {
  /** Function that returns the current git branch (e.g. via `git branch --show-current`) */
  getBranch: () => string;
  /** If true, the branch is a static override and should not be refreshed */
  isStaticOverride?: boolean;
  /** Event callbacks */
  events?: BranchDetectorEvents;
}

export class BranchDetector {
  private _currentBranch: string;
  private _getBranch: () => string;
  private _isStaticOverride: boolean;
  private _events: BranchDetectorEvents;
  private _refreshCount: number = 0;

  constructor(initialBranch: string, options: BranchDetectorOptions) {
    this._currentBranch = initialBranch;
    this._getBranch = options.getBranch;
    this._isStaticOverride = options.isStaticOverride ?? false;
    this._events = options.events ?? {};
  }

  get currentBranch(): string {
    return this._currentBranch;
  }

  get refreshCount(): number {
    return this._refreshCount;
  }

  /**
   * Re-read the current git branch. Returns true if the branch changed.
   * Skipped when the branch is a static override (env var set).
   * Requirements: 7.1, 7.3
   */
  refresh(): boolean {
    this._refreshCount++;
    if (this._isStaticOverride) return false;

    const newBranch = this._getBranch();
    if (newBranch !== this._currentBranch) {
      const oldBranch = this._currentBranch;
      this._currentBranch = newBranch;
      this._events.onBranchChanged?.(oldBranch, newBranch);
      return true;
    }
    return false;
  }
}
