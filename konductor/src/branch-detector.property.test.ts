/**
 * Property-Based Tests for BranchDetector
 *
 * Uses fast-check to verify correctness properties from the design document.
 * Feature: konductor-bugs-and-missing-features
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { BranchDetector } from "./branch-detector.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generate realistic branch names like "main", "feature/foo-bar", "fix/123" */
const branchNameArb = fc.stringMatching(/^[a-z]{1,8}(\/[a-z][a-z0-9-]{0,12})?$/);

/** Generate a non-empty sequence of branch names (simulating branch switches over time) */
const branchSequenceArb = fc.array(branchNameArb, { minLength: 2, maxLength: 20 });

// ---------------------------------------------------------------------------
// Property 4: Branch detection on every poll cycle
// **Feature: konductor-bugs-and-missing-features, Property 4: Branch detection on every poll cycle**
// **Validates: Requirements 7.1, 7.3**
// ---------------------------------------------------------------------------

describe("Branch Detection on Every Poll Cycle — Property Tests", () => {
  /**
   * **Feature: konductor-bugs-and-missing-features, Property 4: Branch detection on every poll cycle**
   * **Validates: Requirements 7.1, 7.3**
   *
   * For any branch switch (changing the output of `git branch --show-current`),
   * the watcher SHALL use the new branch name in the next registration call
   * that occurs after the switch.
   */
  it("Property 4: after each refresh, currentBranch matches the latest git branch output", () => {
    fc.assert(
      fc.property(branchSequenceArb, (branches) => {
        let branchIndex = 0;
        const getBranch = () => branches[branchIndex] ?? "unknown";

        const detector = new BranchDetector(branches[0], {
          getBranch,
        });

        // Simulate poll cycles — each cycle calls refresh()
        for (let i = 1; i < branches.length; i++) {
          branchIndex = i;
          detector.refresh();

          // After refresh, currentBranch must match what getBranch returns
          expect(detector.currentBranch).toBe(branches[i]);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 4 (cont.): refresh is called on every poll cycle (refreshCount tracks calls)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        branchNameArb,
        (pollCycles, initialBranch) => {
          const detector = new BranchDetector(initialBranch, {
            getBranch: () => initialBranch, // branch never changes
          });

          for (let i = 0; i < pollCycles; i++) {
            detector.refresh();
          }

          // refreshCount should equal the number of poll cycles
          expect(detector.refreshCount).toBe(pollCycles);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 4 (cont.): branch change callback fires exactly on transitions", () => {
    fc.assert(
      fc.property(branchSequenceArb, (branches) => {
        let branchIndex = 0;
        const getBranch = () => branches[branchIndex] ?? "unknown";
        const changes: Array<{ from: string; to: string }> = [];

        const detector = new BranchDetector(branches[0], {
          getBranch,
          events: {
            onBranchChanged: (oldBranch, newBranch) => {
              changes.push({ from: oldBranch, to: newBranch });
            },
          },
        });

        // Count expected transitions
        let expectedChanges = 0;
        for (let i = 1; i < branches.length; i++) {
          branchIndex = i;
          const prevBranch = detector.currentBranch;
          detector.refresh();

          if (branches[i] !== prevBranch) {
            expectedChanges++;
          }
        }

        // Callback should have fired exactly for each actual transition
        expect(changes.length).toBe(expectedChanges);

        // Each recorded change should have correct from/to values
        for (const change of changes) {
          expect(change.from).not.toBe(change.to);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 4 (cont.): static override prevents branch refresh", () => {
    fc.assert(
      fc.property(branchSequenceArb, (branches) => {
        let branchIndex = 0;
        const getBranch = () => branches[branchIndex] ?? "unknown";

        const detector = new BranchDetector(branches[0], {
          getBranch,
          isStaticOverride: true,
        });

        // Simulate poll cycles with branch changes
        for (let i = 1; i < branches.length; i++) {
          branchIndex = i;
          const changed = detector.refresh();

          // Should never report a change when static override is set
          expect(changed).toBe(false);
          // Branch should remain the initial value
          expect(detector.currentBranch).toBe(branches[0]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
