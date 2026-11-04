import { describe, expect, it } from "vitest";
import { authorize, AuthorizationError, isCompanyRole, type Actor } from "./authorize";

const companyId = "6f1f3f4e-0000-4000-8000-000000000001";
const admin: Actor = { userId: "u-admin", companyId, role: "admin" };
const clerk: Actor = { userId: "u-clerk", companyId, role: "clerk" };
const guest: Actor = { userId: "u-guest", companyId, role: "guest" };

describe("authorize", () => {
  it("allows admins to manage users", () => {
    expect(() => authorize(admin, "users.manage")).not.toThrow();
  });

  it("denies admin-only actions to clerks", () => {
    expect(() => authorize(clerk, "users.manage")).toThrow(AuthorizationError);
    expect(() => authorize(clerk, "users.invite")).toThrow(AuthorizationError);
  });

  it("allows both roles to process requests", () => {
    expect(() => authorize(admin, "requests.process")).not.toThrow();
    expect(() => authorize(clerk, "requests.process")).not.toThrow();
  });

  it("lets staff start live model calls (uploads, reprocessing), guests only process (#126)", () => {
    expect(() => authorize(admin, "requests.ingest")).not.toThrow();
    expect(() => authorize(clerk, "requests.ingest")).not.toThrow();
    expect(() => authorize(guest, "requests.process")).not.toThrow();
    expect(() => authorize(guest, "requests.ingest")).toThrow(AuthorizationError);
    expect(() => authorize(guest, "users.invite")).toThrow(AuthorizationError);
    expect(() => authorize(guest, "users.manage")).toThrow(AuthorizationError);
  });

  it("denies everything to an actor with an unknown role (fail closed)", () => {
    const stranger = { userId: "u-x", companyId, role: "owner" } as unknown as Actor;

    expect(() => authorize(stranger, "requests.process")).toThrow(AuthorizationError);
  });

  it("denies everything to an actor without a company", () => {
    const orphan = { userId: "u-y", companyId: "", role: "admin" } as Actor;

    expect(() => authorize(orphan, "requests.process")).toThrow(AuthorizationError);
  });

  it("recognises only the pilot roles and the showcase guest", () => {
    expect(isCompanyRole("admin")).toBe(true);
    expect(isCompanyRole("clerk")).toBe(true);
    expect(isCompanyRole("guest")).toBe(true);
    expect(isCompanyRole("owner")).toBe(false);
    expect(isCompanyRole("member")).toBe(false);
  });
});
