"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentActor, getJobClient, getRuntime } from "@/app/_server/runtime";
import { AuthorizationError } from "@/features/identity";
import { approveRequest, correctField, rejectRequest, ReviewRefused } from "@/features/review";

// Server actions of the review screen. Every action resolves the actor from the session and the
// review module authorizes it again next to the data (security rule: never only hidden UI).
const id = z.uuid();

async function actorOrLogin() {
  const actor = await currentActor(await headers());
  if (!actor) redirect("/login");
  return actor;
}

function back(requestId: string, params: Record<string, string>): never {
  redirect(`/requests/${requestId}?${new URLSearchParams(params).toString()}`);
}

async function guarded(requestId: string, action: () => Promise<void>, success: string): Promise<never> {
  try {
    await action();
  } catch (error) {
    if (error instanceof ReviewRefused) back(requestId, { error: error.message });
    if (error instanceof AuthorizationError) back(requestId, { error: "Keine Berechtigung." });
    throw error;
  }
  back(requestId, { done: success });
}

export async function correctFieldAction(formData: FormData): Promise<void> {
  const actor = await actorOrLogin();
  const requestId = id.parse(formData.get("requestId"));
  const fieldKey = String(formData.get("field") ?? "");
  const raw = String(formData.get("value") ?? "");
  await guarded(requestId, () => correctField(getRuntime().tenancy, actor, requestId, fieldKey, raw === "" ? null : raw), "Korrektur gespeichert.");
}

export async function approveAction(formData: FormData): Promise<void> {
  const actor = await actorOrLogin();
  const requestId = id.parse(formData.get("requestId"));
  const boss = await getJobClient();
  await guarded(requestId, () => approveRequest({ tenancy: getRuntime().tenancy, boss }, actor, requestId), "Freigegeben – der Export ist eingeplant.");
}

export async function rejectAction(formData: FormData): Promise<void> {
  const actor = await actorOrLogin();
  const requestId = id.parse(formData.get("requestId"));
  const reason = String(formData.get("reason") ?? "");
  await guarded(requestId, () => rejectRequest(getRuntime().tenancy, actor, requestId, reason), "Abgelehnt.");
}
