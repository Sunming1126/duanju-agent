export const loginRequiredEvent = "plotloom-login-required";

// Only local editor destinations may be resumed after authentication.
export function creationDestination(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin || !/^\/studio\/(?:scripts\/new|novels\/new|works\/[^/]+)\/?$/.test(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}
