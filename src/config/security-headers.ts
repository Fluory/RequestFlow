// Response headers of every route (module `config`; applied in next.config.ts). Evaluated when the app is
// built (the headers land in the routes manifest) – on Vercel the project's environment variables are
// present at build time, so a change of FRAME_ANCESTORS needs a redeploy.
//
// script-src keeps 'unsafe-inline': the App Router streams its RSC payload as inline <script> tags, and a
// nonce would force a fresh server render of every page per request. Everything else is
// own-origin only. tests/e2e/security-headers.spec.ts loads the built pages in a browser and fails on any
// CSP violation.

export interface SecurityHeaderSettings {
  /** Public base URL (BETTER_AUTH_URL): https → HSTS and upgrade-insecure-requests. */
  baseUrl: string;
  /** `next dev`: React needs eval for its debugging stacks (never in production). */
  dev: boolean;
  /**
   * FRAME_ANCESTORS: space-separated https origins allowed to embed the app (e.g. the portfolio site).
   * Empty → no embedding at all (frame-ancestors 'none' + X-Frame-Options DENY).
   */
  frameAncestors: string;
}

const ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/;

function parseFrameAncestors(value: string): string[] {
  const origins = value.split(/\s+/).filter(Boolean);
  if (origins.some((origin) => !ORIGIN.test(origin))) throw new Error("Invalid or missing configuration: FRAME_ANCESTORS");
  return origins;
}

const PERMISSIONS = ["accelerometer", "browsing-topics", "camera", "display-capture", "geolocation", "gyroscope", "magnetometer", "microphone", "payment", "usb"];

export function securityHeaders(settings: SecurityHeaderSettings): Array<{ key: string; value: string }> {
  const https = settings.baseUrl.startsWith("https://");
  const ancestors = parseFrameAncestors(settings.frameAncestors);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${settings.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self'",
    // Style attributes only (next/image renders style="color:transparent", the built-in error pages use style
    // attributes); <style> elements stay blocked.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${ancestors.length ? `'self' ${ancestors.join(" ")}` : "'none'"}`,
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
    ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    // X-Frame-Options cannot list origins: with allowed embedders only frame-ancestors decides.
    ...(ancestors.length ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
    { key: "Permissions-Policy", value: PERMISSIONS.map((feature) => `${feature}=()`).join(", ") },
  ];
}
