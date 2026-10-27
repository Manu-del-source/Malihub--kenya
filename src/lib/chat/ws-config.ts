/** Validate the configured realtime destination before issuing credentials or
 * adding it to CSP. Only local development may use unencrypted WebSockets. */
export function resolveChatWebSocketBase(
  value: string | undefined,
  environment: string | undefined = process.env.NODE_ENV
): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const localDev = environment !== "production" && url.protocol === "ws:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "wss:" && !localDev) || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}
