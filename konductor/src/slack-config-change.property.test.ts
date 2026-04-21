/**
 * Property-Based Test for Slack Config Change Notification Delivery
 *
 * **Feature: konductor-slack, Property 6: Config change notification delivery**
 * **Validates: Requirements 4.1, 4.2, 4.3**
 *
 * For any Slack config change (channel or verbosity), the emitted
 * `slack_config_change` event SHALL contain the new channel, new verbosity,
 * the userId who made the change, and a valid Slack channel link.
 * The event SHALL be scoped to the correct repo.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { BatonEventEmitter } from "./baton-event-emitter.js";
import type { BatonEvent, SlackConfigChangeEvent } from "./baton-types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const repoArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,15}\/[a-z][a-z0-9-]{1,15}$/);

const channelArb = fc.stringMatching(/^[a-z][a-z0-9_-]{1,30}$/);

const verbosityArb = fc.integer({ min: 0, max: 5 });

const userIdArb = fc.stringMatching(/^[a-z][a-z0-9_]{2,15}$/);

// ---------------------------------------------------------------------------
// Property 6: Config change notification delivery
// ---------------------------------------------------------------------------

describe("Property 6: Config change notification delivery", () => {
  it("emitted slack_config_change event contains correct channel, verbosity, changedBy, slackChannelLink, scoped to correct repo", () => {
    fc.assert(
      fc.property(
        repoArb,
        channelArb,
        verbosityArb,
        userIdArb,
        (repo, channel, verbosity, changedBy) => {
          const emitter = new BatonEventEmitter();
          const receivedEvents: BatonEvent[] = [];

          // Subscribe to the specific repo
          const unsub = emitter.subscribe(repo, (event) => {
            receivedEvents.push(event);
          });

          // Also subscribe to a different repo to verify scoping
          const otherRepoEvents: BatonEvent[] = [];
          const unsubOther = emitter.subscribe("other/repo", (event) => {
            otherRepoEvents.push(event);
          });

          // Build and emit the event (same logic as the PUT handler)
          const slackChannelLink = `https://slack.com/app_redirect?channel=${channel}`;
          const eventData: SlackConfigChangeEvent = {
            channel,
            verbosity,
            changedBy,
            slackChannelLink,
          };
          emitter.emit({
            type: "slack_config_change",
            repo,
            data: eventData,
          });

          // Verify event was received by the correct repo subscriber
          expect(receivedEvents).toHaveLength(1);
          const event = receivedEvents[0];
          expect(event.type).toBe("slack_config_change");
          expect(event.repo).toBe(repo);

          // Verify event data contains all required fields
          const data = event.data as SlackConfigChangeEvent;
          expect(data.channel).toBe(channel);
          expect(data.verbosity).toBe(verbosity);
          expect(data.changedBy).toBe(changedBy);
          expect(data.slackChannelLink).toBe(slackChannelLink);
          expect(data.slackChannelLink).toContain("https://slack.com/app_redirect?channel=");
          expect(data.slackChannelLink).toContain(channel);

          // Verify event was NOT received by other repo subscriber
          expect(otherRepoEvents).toHaveLength(0);

          unsub();
          unsubOther();
        },
      ),
      { numRuns: 100 },
    );
  });
});
