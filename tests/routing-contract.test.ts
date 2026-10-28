import { describe, expect, it } from "vitest";
import {
  validateRoutingResult,
  isValidRouteName,
  RoutingResult,
  RouteName,
} from "../lib/context-selector";

describe("routing contract", () => {
  it("accepts MIXED with confidence 1.0", () => {
    const result = validateRoutingResult({
      routes: ["SESSION_CONTEXT", "PERSONAL_MEMORY", "GENERAL_KNOWLEDGE"],
      query_rewrites: ["combine_memory_and_trend"],
      needs_clarification: false,
      clarification_question: null,
      confidence: 0.95,
      reason_codes: ["REFERENCES_PRIOR_CONVERSATION", "INDUSTRY_TREND"],
    });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.routes.length).toBeGreaterThanOrEqual(2);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.needs_clarification).toBe(false);
      expect(result.clarification_question).toBeNull();
      expect(result.routes.every((r) => isValidRouteName(r))).toBe(true);
    }
  });

  it("accepts CLARIFY when ambiguous", () => {
    const result = validateRoutingResult({
      routes: ["CLARIFY"],
      query_rewrites: ["clarify_target"],
      needs_clarification: true,
      clarification_question: "Which business do you mean?",
      confidence: 0.55,
      reason_codes: ["AMBIGUOUS_TARGET"],
    });
    expect(result).not.toBeNull();
    expect(result?.routes).toContain("CLARIFY");
    expect(result?.needs_clarification).toBe(true);
  });

  it("rejects unknown route names", () => {
    const bad = validateRoutingResult({
      routes: ["SESSION_CONTEXT", "FAKE_ROUTE"],
      query_rewrites: [],
      needs_clarification: false,
      clarification_question: null,
      confidence: 0.8,
      reason_codes: [],
    });
    expect(bad).toBeNull();
  });

  it("rejects empty routes", () => {
    expect(
      validateRoutingResult({
        routes: [],
        query_rewrites: [],
        needs_clarification: false,
        clarification_question: null,
        confidence: 0.8,
        reason_codes: [],
      })
    ).toBeNull();
  });

  it("clamps confidence between 0 and 1", () => {
    const over = validateRoutingResult({
      routes: ["SESSION_CONTEXT"],
      query_rewrites: [],
      needs_clarification: false,
      clarification_question: null,
      confidence: 1.55,
      reason_codes: [],
    });
    expect(over?.confidence).toBe(1);

    const under = validateRoutingResult({
      routes: ["SESSION_CONTEXT"],
      query_rewrites: [],
      needs_clarification: false,
      clarification_question: null,
      confidence: -0.3,
      reason_codes: [],
    });
    expect(under?.confidence).toBe(0);
  });

  it("accepts TOOL_ACTION independently", () => {
    const result = validateRoutingResult({
      routes: ["TOOL_ACTION"],
      query_rewrites: ["authorized_tool"],
      needs_clarification: false,
      clarification_question: null,
      confidence: 0.9,
      reason_codes: ["TOOL_ACTION_REQUESTED"],
    });
    expect(result?.routes).toEqual(["TOOL_ACTION"]);
  });

  it("only allows defined RouteName values", () => {
    expect(isValidRouteName("SESSION_CONTEXT")).toBe(true);
    expect(isValidRouteName("PERSONAL_MEMORY")).toBe(true);
    expect(isValidRouteName("GENERAL_KNOWLEDGE")).toBe(true);
    expect(isValidRouteName("TOOL_ACTION")).toBe(true);
    expect(isValidRouteName("MIXED")).toBe(true);
    expect(isValidRouteName("CLARIFY")).toBe(true);
    expect(isValidRouteName("UNAUTHORIZED")).toBe(false);
  });
});
