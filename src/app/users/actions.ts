"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { currentActor, getRuntime } from "@/app/_server/runtime";
import { AuthorizationError, changeUserRole, COMPANY_ROLES, LastAdminError, setUserActive, UserNotInCompany } from "@/features/identity";

// Server actions of the user management page (#30). Each resolves the actor from the session; the
// identity module authorizes again next to the data (security rule: never only hidden UI). A clerk
// gets 404 – the page does not exist for them. Feedback travels as fixed codes (never free text).
const userId = z.uuid();

async function actorOrLogin() {
  const actor = await currentActor(await headers());
  if (!actor) redirect("/login");
  return actor;
}

async function guarded(action: () => Promise<void>, done: string): Promise<never> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    if (error instanceof LastAdminError) redirect("/users?error=last_admin");
    if (error instanceof UserNotInCompany) redirect("/users?error=unknown_user");
    throw error;
  }
  redirect(`/users?done=${done}`);
}

function targetOf(formData: FormData): string {
  const parsed = userId.safeParse(formData.get("userId"));
  if (!parsed.success) redirect("/users?error=unknown_user");
  return parsed.data;
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const actor = await actorOrLogin();
  const target = targetOf(formData);
  const role = z.enum(COMPANY_ROLES).safeParse(formData.get("role"));
  if (!role.success) redirect("/users?error=input");
  await guarded(() => changeUserRole(getRuntime().database.db, actor, target, role.data), "role_changed");
}

export async function deactivateAction(formData: FormData): Promise<void> {
  const actor = await actorOrLogin();
  const target = targetOf(formData);
  await guarded(() => setUserActive(getRuntime().database.db, actor, target, false), "deactivated");
}

export async function reactivateAction(formData: FormData): Promise<void> {
  const actor = await actorOrLogin();
  const target = targetOf(formData);
  await guarded(() => setUserActive(getRuntime().database.db, actor, target, true), "reactivated");
}
