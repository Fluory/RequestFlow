"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { drainAfterResponse } from "@/app/_server/drain";
import { currentActor, getJobClient, getRuntime } from "@/app/_server/runtime";
import { AuthorizationError } from "@/features/identity";
import { approveRequest, confirmNotDuplicate, correctField, rejectAsDuplicate, rejectRequest, ReviewRefused } from "@/features/review";

// Server actions of the review screen. Every action resolves the actor from the session and the
// review module authorizes it again next to the data (security rule: never only hidden UI).
const id = z.uuid();

async function actorOrLogin() {
  const actor = await currentActor(await headers());
  if (!actor) redirect("/login");
  return actor;
}

function requestIdOf(formData: FormData): string {
  const parsed = id.safeParse(formData.get("requestId"));
  if (!parsed.success) notFound();
  return parsed.data;
}

// Only fixed codes go into the URL; the page maps them to texts (messages.ts).
function back(requestId: string, params: { done: string } | { error: string }): never {
  redirect(`/requests/${requestId}?${new URLSearchParams(params).toString()}`);
}

async function guarded(requestId: string, action: () => Promise<void>, done: "corrected" | "approved" | "rejected" | "not_duplicate"): Promise<never> {
  try {
    await action();
  } catch (error) {
    if (error instanceof ReviewRefused) back(requestId, { error: error.code });
    if (error instanceof AuthorizationError) back(requestId, { error: "forbidden" });
    throw error;
  }
  back(requestId, { done });
}

export async function correctFieldAction(formData: FormData): Promise<void> {
  const actor = await actorOrLogin();
  const requestId = requestIdOf(formData);
  const fieldKey = String(formData.get("field") ?? "");
  const raw = String(formData.get("value") ?? "");
  // Line-item field (#25): the position travels as `item`; anything but a small integer is refused.
  const item = formData.get("item");
  const itemIndex = item === null ? null : /^\d{1,4}$/.test(String(item)) ? Number(item) : -1;
  await guarded(requestId, () => correctField(getRuntime().tenancy, actor, requestId, fieldKey, raw === "" ? null : raw, itemIndex), "corrected");
}

export async function approveAction(formData: FormData): Promise<void> {
  const actor = await actorOrLogin();
  const requestId = requestIdOf(formData);
  const boss = await getJobClient();
  await guarded(
    requestId,
    async () => {
      await approveRequest({ tenancy: getRuntime().tenancy, boss }, actor, requestId);
      drainAfterResponse(); // serverless runtimes only (JOB_DRAIN_INLINE=true): export right away
    },
    "approved",
  );
}

export async function rejectAction(formData: FormData): Promise<void> {
  const actor = await actorOrLogin();
  const requestId = requestIdOf(formData);
  const reason = String(formData.get("reason") ?? "");
  await guarded(requestId, () => rejectRequest(getRuntime().tenancy, actor, requestId, reason), "rejected");
}

export async function confirmNotDuplicateAction(formData: FormData): Promise<void> {
  const actor = await actorOrLogin();
  const requestId = requestIdOf(formData);
  await guarded(requestId, () => confirmNotDuplicate(getRuntime().tenancy, actor, requestId), "not_duplicate");
}

export async function rejectAsDuplicateAction(formData: FormData): Promise<void> {
  const actor = await actorOrLogin();
  const requestId = requestIdOf(formData);
  const reason = String(formData.get("reason") ?? "");
  await guarded(requestId, () => rejectAsDuplicate(getRuntime().tenancy, actor, requestId, reason), "rejected");
}
