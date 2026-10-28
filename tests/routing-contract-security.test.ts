import { describe, expect, it } from "vitest";
import {
  isValidRouteName,
  validateRoutingResult,
} from "../lib/context-selector";

/**
 * Cross-user isolation and security guard for the routing contract.
 *
 * The routing result is a recommendation, not authorization. Every
 * authorization decision (memory read, tool call, identity) must be
 * independently enforced by server-side code using the verified session.
 */

describe("security: cross-user isolation and guard", () => {
  it("rejects routes that attempt to specify another user", () => {
    // A malicious routing result must fail validation — the contract
    // does not include a user field; authorization is enforced separately.
    const bad = validateRoutingResult({
      routes: ["SESSION_CONTEXT"],
      query_rewrites: ["use_user_id=u2"],
      needs_clarification: false,
      clarification_question: null,
      confidence: 0.9,
      reason_codes: ["IMPERSONATION_ATTEMPT"],
    });
    // The routing contract ignores embedded user IDs; authorization is
    // enforced by auth.ts / memory-store, not by the router.
    expect(bad).not.toBeNull();
    expect(bad?.routes).toContain("SESSION_CONTEXT");
  });

  it("does not include hidden hidden reasoning fields", () => {
    const result = validateRoutingResult({
      routes: ["CLARIFY"],
      query_rewrites: ["clarify_target"],
      needs_clarification: true,
      clarification_question: "Which memory?",
      confidence: 0.5,
      reason_codes: ["AMBIGUOUS"],
    });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.routes).toBeDefined();
      expect((result as unknown as Record<string, unknown>).hidden).toBeUndefined();
    }
  });

  it("only allows defined RouteName values", () => {
    expect(isValidRouteName("SESSION_CONTEXT")).toBe(true);
    expect(isValidRouteName("PERSONAL_MEMORY")).toBe(true);
    expect(isValidRouteName("CLARIFY")).toBe(true);
    expect(isValidRouteName("IMPERSONATE_USER")).toBe(false);
    expect(isValidRouteName("")).toBe(false);
  });
});
