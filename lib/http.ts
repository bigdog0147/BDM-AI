/**
 * Public origin of the current request.
 *
 * Render terminates TLS at its proxy, so the Next.js request URL can be
 * http:// internally. The forwarded headers are used when present so that
 * Supabase redirect links always point at the public https origin.
 *
 * `request.url` must never be used to build an absolute URL. Next.js builds
 * it from the server's own hostname and port, so behind Render it is
 * `https://localhost:10000/...` even though the user reached the app at the
 * custom domain. Redirecting to that address sends the user to a port
 * nothing is listening on.
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
  const hostHeader = request.headers.get("host")?.trim();

  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : url.protocol.replace(":", "");

  // The forwarded host first, then the Host header. `url.host` is the
  // server's internal address on Render and is never a public origin.
  const host = forwardedHost || hostHeader || url.host;

  // A malformed host would end up verbatim in a Location header.
  if (!/^[a-z0-9.\-[\]:]+$/i.test(host)) {
    return url.origin;
  }

  return `${protocol}://${host}`;
}
