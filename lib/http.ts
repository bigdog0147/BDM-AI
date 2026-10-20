/**
 * Public origin of the current request.
 *
 * Render terminates TLS at its proxy, so the Next.js request URL can be
 * http:// internally. The forwarded headers are used when present so that
 * Supabase redirect links always point at the public https origin.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();

  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : url.protocol.replace(":", "");
  const host = forwardedHost || url.host;

  return `${protocol}://${host}`;
}
