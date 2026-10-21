import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Brand asset tests.
 *
 * The logo must be a real, scalable vector: no raster image, no embedded
 * base64 payload, no remote reference, and it must carry an accessible name.
 */

const root = process.cwd();

function read(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

const VECTOR_ASSETS = [
  "public/brand/bdm-emblem.svg",
  "public/brand/bdm-logo.svg",
  "public/brand/bdm-mark.svg",
  "public/brand/bdm-mark-light.svg",
  "app/icon.svg"
];

describe("BDM brand assets", () => {
  it("ships every vector asset the app references", () => {
    for (const asset of VECTOR_ASSETS) {
      const svg = read(asset);
      expect(svg, asset).toContain("<svg");
      expect(svg, asset).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/);
    }
  });

  it("keeps the artwork vector-only", () => {
    for (const asset of VECTOR_ASSETS) {
      const svg = read(asset);
      expect(svg, asset).not.toContain("<image");
      expect(svg, asset).not.toContain("data:image");
      expect(svg, asset).not.toContain("base64");
      expect(svg, asset).not.toMatch(/https?:\/\/[^"']+\.(?:png|jpe?g|gif|webp)/i);
    }
  });

  it("gives the emblem an accessible name and description", () => {
    for (const asset of VECTOR_ASSETS) {
      const svg = read(asset);
      expect(svg, asset).toContain("<title");
      expect(svg, asset).toContain("<desc");
    }
  });

  it("uses the brand palette in the emblem", () => {
    const emblem = read("public/brand/bdm-emblem.svg");
    expect(emblem).toContain("#FFF6D4");
    expect(emblem).toContain("#F7CE62");
    expect(emblem).toContain("#D7A63A");
    expect(emblem).toContain("#B8871F");
    expect(emblem).toContain("#F2C558");
    expect(emblem).toContain("#8A651C");
    expect(emblem).toContain("#5E420D");
    expect(emblem).toContain("#F5C451");
    expect(emblem).toContain("#050B1C");
  });

  it("ships the metallic wordmark with the PERSONAL AI label", () => {
    const logo = read("public/brand/bdm-logo.svg");
    expect(logo).toContain("PERSONAL AI");
    expect(logo).toContain("YOUR LIFE");
    // The wordmark is drawn with paths, not a webfont.
    expect(logo).toContain("<path");
    expect(logo).not.toMatch(/@import|fonts\.googleapis/);
  });

  it("offers a light-surface variant for the compact mark", () => {
    const light = read("public/brand/bdm-mark-light.svg");
    expect(light).toContain("#C79A2E");
    expect(light).toContain("#A97C1F");
    expect(light).toContain("#8A651C");
    expect(light).toContain("#6B4E12");
    expect(light).toContain("#4A3609");
    expect(light).toContain("#8A651C");
    expect(light).toContain("#0B1B3A");
  });

  it("registers the app icon and the web manifest", () => {
    const manifest = read("public/manifest.json");
    expect(manifest).toContain("/brand/bdm-mark.svg");
    expect(manifest).toContain("image/svg+xml");
    expect(JSON.parse(manifest)).toMatchObject({
      name: "BDM - Personal AI",
      short_name: "BDM"
    });

    const layout = read("app/layout.tsx");
    expect(layout).toContain("/manifest.json");
  });

  it("points the layout and the brand component at the real files", () => {
    const logo = read("app/components/BrandLogo.tsx");
    expect(logo).toContain("/brand/bdm-logo.svg");
    expect(logo).toContain("/brand/bdm-mark.svg");
    expect(logo).toContain("/brand/bdm-mark-light.svg");
    expect(logo).toContain("/brand/bdm-emblem.svg");
  });

  it("uses the shared brand component on the dashboard and in the brand sheet", () => {
    // The dashboard renders the brand through BrandLogo rather than hard-coding
    // an asset path, so the brand sheet and the workspace can never drift.
    const logo = read("app/components/BrandLogo.tsx");
    expect(logo).toContain("/brand/bdm-emblem.svg");
    expect(logo).toContain("/brand/bdm-mark.svg");

    // Both dashboard surfaces (navigation and empty state) use that component.
    expect(read("app/components/Sidebar.tsx")).toContain("BrandLogo");
    expect(read("app/components/Welcome.tsx")).toContain("BrandLogo");

    expect(read("app/brand/page.tsx")).toContain("/brand/bdm-emblem.svg");
  });
});
