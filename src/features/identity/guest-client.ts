import { createHmac } from "node:crypto";
import { isIP } from "node:net";

// Client key of the guest access (per-client brake, #126 follow-up). The address comes from the same
// proxy settings as Better Auth's rate limit (AUTH_IP_HEADERS / AUTH_TRUSTED_PROXIES); only a keyed hash
// of it is stored (identity.guest_admission) and deleted with the guest company.
export interface GuestClientSettings {
  ipAddressHeaders: string[];
  trustedProxies: string[];
  /** Server secret (BETTER_AUTH_SECRET): without it the hash of an address cannot be recomputed. */
  secret: string;
}

const UNKNOWN = "unknown";

/** IPv6 is collapsed to its /64 prefix – a single host or household rotates freely inside it. */
function normalise(address: string): string | null {
  const value = address.trim();
  const kind = isIP(value);
  if (kind === 4) return value;
  if (kind !== 6) return null;
  const [head = "", tail = ""] = value.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = value.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  if (groups.some((group) => group.includes("."))) return value.toLowerCase(); // IPv4-mapped: keep as is
  return `${groups.slice(0, 4).map((group) => group.padStart(4, "0")).join(":")}::/64`;
}

/**
 * The client address as the nearest untrusted hop reports it: per configured header the rightmost entry
 * that is not a trusted proxy (entries further left were written by the client and can be forged).
 * No usable address → one shared bucket ("unknown"), so a missing header never bypasses the brake.
 */
export function guestClientAddress(headers: Headers, settings: Pick<GuestClientSettings, "ipAddressHeaders" | "trustedProxies">): string {
  for (const name of settings.ipAddressHeaders) {
    const value = headers.get(name);
    if (!value) continue;
    const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
    while (entries.length && settings.trustedProxies.includes(entries[entries.length - 1]!)) entries.pop();
    const candidate = entries.pop();
    const address = candidate ? normalise(candidate) : null;
    if (address) return address;
  }
  return UNKNOWN;
}

/** Keyed hash (HMAC-SHA-256, hex) of the client address – the value stored for the per-client brake. */
export function guestClientKey(headers: Headers, settings: GuestClientSettings): string {
  return createHmac("sha256", settings.secret).update(`guest-client:${guestClientAddress(headers, settings)}`).digest("hex");
}
