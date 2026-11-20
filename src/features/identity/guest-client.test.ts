import { describe, expect, it } from "vitest";
import { guestClientAddress, guestClientKey } from "./guest-client";

// The per-client brake of the guest access keys on the client address the deployment's proxy reports
// (AUTH_IP_HEADERS / AUTH_TRUSTED_PROXIES, the same settings as Better Auth's rate limit).
const settings = { ipAddressHeaders: ["x-forwarded-for"], trustedProxies: [] as string[], secret: "unit-test-secret-0123456789abcdef" };

describe("guest client address", () => {
  it("takes the address the nearest proxy appended (rightmost entry), not one the client could forge", () => {
    expect(guestClientAddress(new Headers({ "x-forwarded-for": "203.0.113.9" }), settings)).toBe("203.0.113.9");
    expect(guestClientAddress(new Headers({ "x-forwarded-for": "198.51.100.1, 203.0.113.9" }), settings)).toBe("203.0.113.9");
  });

  it("skips trusted proxies from the right", () => {
    const behindProxy = { ...settings, trustedProxies: ["10.0.0.5"] };
    expect(guestClientAddress(new Headers({ "x-forwarded-for": "198.51.100.1, 203.0.113.9, 10.0.0.5" }), behindProxy)).toBe("203.0.113.9");
  });

  it("collapses IPv6 to its /64 prefix (one household or host rotates inside it)", () => {
    const a = guestClientAddress(new Headers({ "x-forwarded-for": "2001:db8:1:2::1" }), settings);
    const b = guestClientAddress(new Headers({ "x-forwarded-for": "2001:db8:1:2:ffff::9" }), settings);
    expect(a).toBe(b);
    expect(a).not.toBe(guestClientAddress(new Headers({ "x-forwarded-for": "2001:db8:1:3::1" }), settings));
  });

  it("falls back to one shared bucket when no usable address is present", () => {
    expect(guestClientAddress(new Headers(), settings)).toBe("unknown");
    expect(guestClientAddress(new Headers({ "x-forwarded-for": "not-an-ip" }), settings)).toBe("unknown");
    expect(guestClientAddress(new Headers({ "x-real-ip": "203.0.113.9" }), settings)).toBe("unknown");
  });
});

describe("guest client key", () => {
  it("is a keyed hash: stable per address, different per address and per secret, never the address", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
    const key = guestClientKey(headers, settings);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.9");
    expect(guestClientKey(new Headers({ "x-forwarded-for": "203.0.113.9" }), settings)).toBe(key);
    expect(guestClientKey(new Headers({ "x-forwarded-for": "203.0.113.10" }), settings)).not.toBe(key);
    expect(guestClientKey(headers, { ...settings, secret: "another-secret-0123456789abcdef" })).not.toBe(key);
  });
});
