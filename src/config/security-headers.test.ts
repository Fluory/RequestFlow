import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

// Response headers of every route (next.config.ts). The policy must be what the built app passes:
// tests/e2e/security-headers.spec.ts loads the pages in a browser and fails on any CSP violation.
const asMap = (headers: Array<{ key: string; value: string }>) => new Map(headers.map((header) => [header.key.toLowerCase(), header.value]));
const directives = (csp: string) => new Map(csp.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
  const [name = "", ...values] = part.split(/\s+/);
  return [name, values.join(" ")] as const;
}));

describe("security headers", () => {
  const production = asMap(securityHeaders({ baseUrl: "https://demo.example.org", dev: false, frameAncestors: "" }));
  const csp = directives(production.get("content-security-policy") ?? "");

  it("sets a restrictive CSP: own origin only, no plugins, no foreign forms, no base rewrite, no framing", () => {
    expect(csp.get("default-src")).toBe("'self'");
    expect(csp.get("script-src")).toBe("'self' 'unsafe-inline'");
    expect(csp.get("style-src")).toBe("'self'");
    // Only style attributes (next/image sets style="color:transparent"); no inline <style> elements.
    expect(csp.get("style-src-attr")).toBe("'unsafe-inline'");
    expect(csp.get("img-src")).toBe("'self' data:");
    expect(csp.get("font-src")).toBe("'self'");
    expect(csp.get("connect-src")).toBe("'self'");
    expect(csp.get("object-src")).toBe("'none'");
    expect(csp.get("base-uri")).toBe("'self'");
    expect(csp.get("form-action")).toBe("'self'");
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("frame-src")).toBe("'none'");
    expect(csp.has("upgrade-insecure-requests")).toBe(true);
    expect(csp.get("script-src")).not.toContain("unsafe-eval");
  });

  it("sets HSTS, nosniff, referrer policy, frame protection and a permissions policy", () => {
    expect(production.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains");
    expect(production.get("x-content-type-options")).toBe("nosniff");
    expect(production.get("referrer-policy")).toBe("same-origin");
    expect(production.get("x-frame-options")).toBe("DENY");
    const permissions = production.get("permissions-policy") ?? "";
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) expect(permissions).toContain(`${feature}=()`);
  });

  it("allows embedding only by the configured https origins (then without X-Frame-Options, which cannot list origins)", () => {
    const embedded = asMap(securityHeaders({ baseUrl: "https://demo.example.org", dev: false, frameAncestors: "https://portfolio.example.org https://www.example.org" }));
    expect(directives(embedded.get("content-security-policy") ?? "").get("frame-ancestors")).toBe("'self' https://portfolio.example.org https://www.example.org");
    expect(embedded.has("x-frame-options")).toBe(false);
    expect(() => securityHeaders({ baseUrl: "https://demo.example.org", dev: false, frameAncestors: "http://insecure.example.org" })).toThrow(/FRAME_ANCESTORS/);
    expect(() => securityHeaders({ baseUrl: "https://demo.example.org", dev: false, frameAncestors: "*" })).toThrow(/FRAME_ANCESTORS/);
    expect(() => securityHeaders({ baseUrl: "https://demo.example.org", dev: false, frameAncestors: "https://a.example.org; script-src *" })).toThrow(/FRAME_ANCESTORS/);
  });

  it("over plain http (local) sends neither HSTS nor upgrade-insecure-requests; dev mode adds only unsafe-eval", () => {
    const local = asMap(securityHeaders({ baseUrl: "http://localhost:3000", dev: true, frameAncestors: "" }));
    const localCsp = directives(local.get("content-security-policy") ?? "");
    expect(local.has("strict-transport-security")).toBe(false);
    expect(localCsp.has("upgrade-insecure-requests")).toBe(false);
    expect(localCsp.get("script-src")).toBe("'self' 'unsafe-inline' 'unsafe-eval'");
  });
});
