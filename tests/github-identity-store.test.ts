import { describe, it, expect } from "vitest";
import { findGitHubLink, githubIdentityStoreConfigured } from "../../lib/github-identity-store";

describe("github-identity-store", () => {
  it("exports findGitHubLink and configured check", () => {
    expect(typeof findGitHubLink).toBe("function");
    expect(typeof githubIdentityStoreConfigured).toBe("function");
  });
});
