import { describe, expect, it } from "vitest";

async function get() {
  const { GET } = await import("../app/api/health/route");
  return GET();
}

describe("GET /api/health", () => {
  it("returns ok with the service identity", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.service).toBe("bdm-ai");
    expect(data.version).toBe("0.1.0");
  });

  it("returns a valid ISO timestamp", async () => {
    const data = await (await get()).json();
    expect(Number.isNaN(Date.parse(data.time))).toBe(false);
  });
});
