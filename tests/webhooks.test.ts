import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Resend webhook tests.
 *
 * Signatures are computed locally with the published Svix scheme. No webhook
 * is delivered and no database is touched.
 */

const h = vi.hoisted(() => ({
  select: vi.fn()
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      upsert: () => ({ select: h.select })
    })
  })
}));

const SECRET_BYTES = Buffer.from("test-webhook-signing-secret");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

function sign(id: string, timestamp: string, body: string): string {
  return createHmac("sha256", SECRET_BYTES)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
}

const ENV_KEYS = [
  "RESEND_WEBHOOK_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
] as const;

let originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  delete process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  h.select.mockReset();
  h.select.mockResolvedValue({ data: [{ id: 1 }], error: null });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.restoreAllMocks();
});

// --------------------------------------------------------------- verification

describe("Svix signature verification", () => {
  const now = 1_700_000_000;

  it("accepts a correctly signed request", async () => {
    const { verifySvixSignature } = await import("../lib/webhooks");
    const body = JSON.stringify({ type: "email.delivered" });

    expect(
      verifySvixSignature({
        secret: SECRET,
        id: "msg_1",
        timestamp: String(now),
        signature: `v1,${sign("msg_1", String(now), body)}`,
        body,
        nowSeconds: now
      })
    ).toEqual({ ok: true });
  });

  it("accepts a valid candidate among several", async () => {
    const { verifySvixSignature } = await import("../lib/webhooks");
    const body = "{}";
    const good = sign("msg_2", String(now), body);

    expect(
      verifySvixSignature({
        secret: SECRET,
        id: "msg_2",
        timestamp: String(now),
        signature: `v1,bm90LXRoZS1zaWduYXR1cmU= v1,${good}`,
        body,
        nowSeconds: now
      })
    ).toEqual({ ok: true });
  });

  it("rejects a tampered body in constant time", async () => {
    const { verifySvixSignature } = await import("../lib/webhooks");
    const original = JSON.stringify({ type: "email.delivered" });
    const tampered = JSON.stringify({ type: "email.bounced" });

    expect(
      verifySvixSignature({
        secret: SECRET,
        id: "msg_3",
        timestamp: String(now),
        signature: `v1,${sign("msg_3", String(now), original)}`,
        body: tampered,
        nowSeconds: now
      })
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects stale and malformed timestamps", async () => {
    const { verifySvixSignature } = await import("../lib/webhooks");
    const body = "{}";
    const signature = `v1,${sign("msg_4", String(now), body)}`;

    expect(
      verifySvixSignature({
        secret: SECRET,
        id: "msg_4",
        timestamp: String(now),
        signature,
        body,
        nowSeconds: now + 301
      })
    ).toEqual({ ok: false, reason: "stale" });

    expect(
      verifySvixSignature({
        secret: SECRET,
        id: "msg_4",
        timestamp: "later",
        signature,
        body,
        nowSeconds: now
      })
    ).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("rejects missing headers and missing configuration", async () => {
    const { verifySvixSignature } = await import("../lib/webhooks");

    expect(
      verifySvixSignature({
        secret: SECRET,
        id: null,
        timestamp: String(now),
        signature: "v1,x",
        body: "{}",
        nowSeconds: now
      })
    ).toEqual({ ok: false, reason: "missing_headers" });

    expect(
      verifySvixSignature({
        secret: "",
        id: "msg_5",
        timestamp: String(now),
        signature: "v1,x",
        body: "{}",
        nowSeconds: now
      })
    ).toEqual({ ok: false, reason: "not_configured" });
  });
});

// --------------------------------------------------------------- normalization

describe("event normalization", () => {
  it("keeps only delivery metadata", async () => {
    const { normalizeResendEvent } = await import("../lib/webhooks");

    const event = normalizeResendEvent(
      {
        type: "email.delivered",
        created_at: "2026-10-20T12:00:00.000Z",
        data: {
          email_id: "email_1",
          to: ["private@example.com"],
          subject: "Private subject",
          text: "Private body"
        }
      },
      "msg_1"
    );

    expect(event).toEqual({
      eventType: "email.delivered",
      eventId: "msg_1",
      emailId: "email_1",
      provider: "resend",
      occurredAt: "2026-10-20T12:00:00.000Z"
    });
    expect(JSON.stringify(event)).not.toContain("private@example.com");
    expect(JSON.stringify(event)).not.toContain("Private subject");
  });

  it("ignores unsupported event types", async () => {
    const { normalizeResendEvent } = await import("../lib/webhooks");
    expect(normalizeResendEvent({ type: "email.unknown" }, "msg_1")).toBeNull();
    expect(normalizeResendEvent(null, "msg_1")).toBeNull();
  });
});

// --------------------------------------------------------------------- route

describe("POST /api/webhooks/resend", () => {
  const now = Math.floor(Date.now() / 1000);

  function signedRequest(
    body: string,
    options: { id?: string; timestamp?: string; secret?: string } = {}
  ): Request {
    const id = options.id ?? "msg_route";
    const timestamp = options.timestamp ?? String(now);
    const signature = sign(id, timestamp, body);

    return new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${options.secret ?? signature}`
      },
      body
    });
  }

  const body = JSON.stringify({
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: { email_id: "email_1", to: ["private@example.com"] }
  });

  it("reports 503 when the webhook secret is absent", async () => {
    const { POST } = await import("../app/api/webhooks/resend/route");
    const response = await POST(signedRequest(body));
    expect(response.status).toBe(503);
  });

  it("rejects an invalid signature with 401", async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    const { POST } = await import("../app/api/webhooks/resend/route");
    const response = await POST(signedRequest(body, { secret: "bm90LXZhbGlk" }));

    expect(response.status).toBe(401);
    expect(h.select).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON even when correctly signed", async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    const { POST } = await import("../app/api/webhooks/resend/route");
    const response = await POST(signedRequest("{not-json"));

    expect(response.status).toBe(400);
  });

  it("acknowledges without pretending to store when no service key exists", async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    const { POST } = await import("../app/api/webhooks/resend/route");
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ ok: true, stored: false, storage: "not_configured" });
    expect(h.select).not.toHaveBeenCalled();
  });

  it("stores a verified event with the service role", async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";

    const { POST } = await import("../app/api/webhooks/resend/route");
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      stored: true,
      duplicate: false,
      storage: "service_role"
    });
    expect(h.select).toHaveBeenCalledTimes(1);
  });

  it("treats a replay as a duplicate", async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    h.select.mockResolvedValue({ data: [], error: null });

    const { POST } = await import("../app/api/webhooks/resend/route");
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stored: true, duplicate: true });
  });

  it("returns 503 on a real storage failure so the provider retries", async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    h.select.mockResolvedValue({ data: null, error: { code: "XX000" } });

    const { POST } = await import("../app/api/webhooks/resend/route");
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(503);
  });
});
