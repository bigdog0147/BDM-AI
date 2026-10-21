import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Deployment configuration for the Google sign-in flow.
 *
 * The redirect URI has to be identical in three places at once: the OAuth
 * client in Google Cloud Console, `GOOGLE_REDIRECT_URI` on the server, and
 * the setup instructions the owner follows. When they drift, Google answers
 * with `redirect_uri_mismatch` and sign-in fails with no useful error on the
 * app side. These assertions pin the value so the drift is caught in CI
 * instead of by a user who cannot sign in.
 */

/** The public origin the live app is served from. */
const PRODUCTION_ORIGIN = "https://bdmai.cloud";
const PRODUCTION_CALLBACK = `${PRODUCTION_ORIGIN}/auth/callback/google`;

/**
 * The local dev server runs on a fixed port. It cannot use 3000 because
 * Docker holds that port on the development host, and an auto-selected port
 * would change the derived callback URL from one run to the next.
 */
const LOCAL_PORT = 3001;
const LOCAL_CALLBACK = `http://localhost:${LOCAL_PORT}/auth/callback/google`;

/** Files that tell the owner which redirect URI to register. */
const INSTRUCTED_FILES = [
  ".env.example",
  "README.md",
  "docs/RENDER_DEPLOYMENT.md"
];

const root = process.cwd();

function read(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

describe("Google OAuth deployment configuration", () => {
  it("points render.yaml at the production callback", () => {
    const render = read("render.yaml");
    expect(render).toContain(`value: ${PRODUCTION_CALLBACK}`);
  });

  it("never advertises the retired onrender subdomain", () => {
    // The old subdomain is a separate Render service that is not configured
    // for sign-in. Leaving it in the setup instructions sends the owner to
    // register a callback that can never complete a login.
    for (const file of ["render.yaml", ...INSTRUCTED_FILES]) {
      expect(read(file), file).not.toContain("bdm-ai.onrender.com");
    }
  });

  it("tells the owner to register the production callback", () => {
    for (const file of INSTRUCTED_FILES) {
      expect(read(file), file).toContain(PRODUCTION_CALLBACK);
    }
  });

  it("tells the owner to register the local callback", () => {
    for (const file of INSTRUCTED_FILES) {
      expect(read(file), file).toContain(LOCAL_CALLBACK);
    }
  });

  it("pins the dev server to a fixed port", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    const dev = pkg.scripts?.dev ?? "";
    expect(dev).toMatch(/-p\s+\d+/);

    const port = Number(/-p\s+(\d+)/.exec(dev)?.[1]);
    expect(port).toBe(LOCAL_PORT);
  });

  it("keeps the local callback on a port the dev server can actually bind", () => {
    // The local callback is only usable if it matches the dev port, otherwise
    // Google redirects to a URL nothing is listening on.
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    const dev = pkg.scripts?.dev ?? "";
    const port = Number(/-p\s+(\d+)/.exec(dev)?.[1]);
    expect(LOCAL_CALLBACK).toContain(`:${port}`);
  });
});
