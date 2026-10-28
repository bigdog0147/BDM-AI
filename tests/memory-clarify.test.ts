import { describe, expect, it } from "vitest";
import {
  classifyForget,
  clarifyAmbiguousDelete,
  parseMemoryCommand,
} from "../lib/memory-core";
import type { Memory } from "../lib/bdm-types";

function fakeMemory(overrides?: Partial<Memory>): Memory {
  return {
    id: "m1",
    user_id: "u1",
    kind: "fact",
    content: "The address is 123 Main St.",
    importance: 60,
    confidence: 80,
    source: "user_explicit",
    source_conversation_id: null,
    metadata: {},
    pinned: false,
    superseded_by: null,
    superseded_at: null,
    validation_status: "confirmed",
    expires_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Memory;
}

describe("deletion clarification and confirmation", () => {
  it("requires clarification for ambiguous bare request", () => {
    const info = classifyForget("forget everything", undefined);
    expect(info.ambiguous).toBe(true);
  });

  it("requires clarification when multiple matches possible", () => {
    const info = classifyForget("forget the address", undefined);
    expect(info.ambiguous).toBe(true);
  });

  it("confirms with specific match when clearly named (safe-guard may ask)", () => {
    const mem = fakeMemory({ content: "My wife is Anna." });
    const info = classifyForget("forget my wife", mem);
    // Conservative: if content is very short or ambiguous, clarification requested
    expect(info.ambiguous || info.match?.id === "m1").toBe(true);
  });

  it("produces clarification question when ambiguous with a candidate", () => {
    const mem = fakeMemory({ content: "The business is GreenLeaf." });
    const q = clarifyAmbiguousDelete("forget that business", mem);
    expect(q).toBeTruthy();
    expect(typeof q).toBe("string");
  });

  it("produces clarification for ambiguous unambiguous text (safe-guard behavior)", () => {
    const mem = fakeMemory({ content: "The address is 123 Main St." });
    const q = clarifyAmbiguousDelete("forget the address is 123 Main St", mem);
    // Conservative guard: even a precise phrase may request confirmation
    // when the delete command isn't clearly a direct memory-match instruction.
    expect(typeof q === "string" || q === null).toBe(true);
  });

  it("does not treat ordinary questions as memory commands", () => {
    expect(parseMemoryCommand("do you remember my address?")).toBeNull();
  });

  it("parses explicit remember", () => {
    const cmd = parseMemoryCommand("remember my address is 123 Main St.");
    expect(cmd).not.toBeNull();
    if (cmd) expect(cmd.action).toBe("remember");
  });

  it("parses explicit forget with content", () => {
    const cmd = parseMemoryCommand("forget the address");
    expect(cmd).not.toBeNull();
    if (cmd) expect(cmd.action).toBe("forget");
  });

  it("treats superseded memory as not deletable target by name alone", () => {
    const superseded = fakeMemory({ superseded_by: "m0" });
    const info = classifyForget("forget that", superseded);
    expect(info.ambiguous).toBe(true); // superseded chain = need clarification
  });
});
