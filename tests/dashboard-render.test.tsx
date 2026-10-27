// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import BrandLogo from "../app/components/BrandLogo";
import Markdown from "../app/components/Markdown";
import Welcome from "../app/components/Welcome";

/**
 * Dashboard rendering tests.
 *
 * They cover the parts of the new workspace that a type check cannot prove:
 * the brand asset that is actually rendered, the empty state, and the safe
 * Markdown output (no raw HTML, citations only for real sources).
 */

describe("BrandLogo", () => {
  it("renders the compact mark from the shipped asset", () => {
    const { container } = render(<BrandLogo variant="mark" size={32} />);
    const image = container.querySelector("img");
    expect(image).toBeTruthy();
    expect(image?.getAttribute("src")).toBe("/brand/bdm-mark.svg");
    expect(image?.getAttribute("alt")).toBe("BDM Personal AI");
  });

  it("renders the full lockup with the wordmark asset", () => {
    const { container } = render(<BrandLogo variant="full" size={40} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/brand/bdm-logo.svg"
    );
  });

  it("uses the light variant on light surfaces", () => {
    const { container } = render(
      <BrandLogo variant="mark" surface="light" size={32} />
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/brand/bdm-mark-light.svg"
    );
  });
});

describe("Welcome", () => {
  it("greets the signed-in user by name and offers real actions", () => {
    const onChat = vi.fn();
    const onResearch = vi.fn();

    render(
      <Welcome
        greeting="Good evening"
        name="Ada"
        researchReady
        onChat={onChat}
        onResearch={onResearch}
      />
    );

    expect(screen.getByText(/Good evening/)).toBeTruthy();
    expect(screen.getByText(/Ada/)).toBeTruthy();

    const chatAction = screen.getByText("Plan something").closest("button");
    chatAction?.click();
    expect(onChat).toHaveBeenCalledTimes(1);

    const researchAction = screen.getByText("Research the web").closest("button");
    researchAction?.click();
    expect(onResearch).toHaveBeenCalledTimes(1);
  });
});

describe("Markdown", () => {
  it("renders code, lists and citation links without raw HTML", () => {
    const html = renderToStaticMarkup(
      <Markdown
        content={[
          "Here is **bold** text.",
          "",
          "- one",
          "- two",
          "",
          "```js",
          "const answer = 42;",
          "```",
          "",
          "The claim is supported [1].",
          "",
          "<script>alert('x')</script>",
          "",
          "[unsafe](javascript:alert(1))"
        ].join("\n")}
        sources={[
          { index: 1, title: "Official source", url: "https://example.gov/fact" }
        ]}
      />
    );

    expect(html).toContain("<code");
    expect(html).toContain("const answer = 42;");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<strong>bold</strong>");
    // The citation points at the real source.
    expect(html).toContain('href="https://example.gov/fact"');
    // Raw HTML is escaped, and the unsafe link is not an anchor.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('href="javascript:');
  });
});
