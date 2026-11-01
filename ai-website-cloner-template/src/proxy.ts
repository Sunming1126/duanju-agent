import { NextResponse, type NextRequest } from "next/server";
import geoip from "geoip-country";
import { isIP } from "node:net";
import { marketForCountry, localeForMarket, parsePreferences } from "./lib/i18n/config";

export function proxy(request: NextRequest) {
  let preferences = parsePreferences(request.cookies.get("plotloom-preferences")?.value);
  if (!preferences) {
    // The reverse proxy must overwrite X-Real-IP; never trust client country headers.
    const ip = request.headers.get("x-real-ip") || "";
    const country = isIP(ip) ? geoip.lookup(ip)?.country || "" : "";
    const market = marketForCountry(country);
    preferences = { market, locale: localeForMarket[market] };
  }
  const value = `${preferences.locale}~${preferences.market}`;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-plotloom-preferences", value);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.append("Vary", "Cookie");
  // Automatic selection is request-scoped; only explicit choices get a durable cookie.
  return response;
}
export const config = { matcher: ["/((?!api|_next|images|favicon.ico).*)"] };
