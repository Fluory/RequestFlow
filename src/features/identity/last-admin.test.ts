import { describe, expect, it } from "vitest";
import { assertAdminRemains, LastAdminError, type MemberState } from "./last-admin";

const admin = (userId: string, active = true): MemberState => ({ userId, role: "admin", active });
const clerk = (userId: string, active = true): MemberState => ({ userId, role: "clerk", active });

describe("last-admin rule (#30): a company always keeps an active admin", () => {
  it("refuses to demote or deactivate the only active admin", () => {
    const members = [admin("a"), clerk("c")];

    expect(() => assertAdminRemains(members, { userId: "a", role: "clerk" })).toThrow(LastAdminError);
    expect(() => assertAdminRemains(members, { userId: "a", active: false })).toThrow(LastAdminError);
  });

  it("allows it when another active admin remains", () => {
    const members = [admin("a"), admin("b"), clerk("c")];

    expect(() => assertAdminRemains(members, { userId: "a", role: "clerk" })).not.toThrow();
    expect(() => assertAdminRemains(members, { userId: "a", active: false })).not.toThrow();
  });

  it("does not count a deactivated admin as remaining", () => {
    expect(() => assertAdminRemains([admin("a"), admin("b", false)], { userId: "a", role: "clerk" })).toThrow(LastAdminError);
  });

  it("never blocks changes that keep or add admins", () => {
    const members = [admin("a"), clerk("c", false)];

    expect(() => assertAdminRemains(members, { userId: "c", role: "admin" })).not.toThrow();
    expect(() => assertAdminRemains(members, { userId: "c", active: true })).not.toThrow();
    expect(() => assertAdminRemains(members, { userId: "a", role: "admin" })).not.toThrow();
  });
});
