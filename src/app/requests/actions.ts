"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { drainAfterResponse } from "@/app/_server/drain";
import { currentActor, getJobClient, getRuntime } from "@/app/_server/runtime";
import { AuthorizationError } from "@/features/identity";
import { reprocessRequest, ReprocessRefused } from "@/features/jobs";

// Reprocess from the request list (#26): ERROR(processing) → NEW + processing job, ERROR(export) →
// APPROVED + export job – status change, job and audit event in ONE transaction (jobs module).
export async function reprocessAction(formData: FormData): Promise<void> {
  const actor = await currentActor(await headers());
  if (!actor) redirect("/login");
  const requestId = z.uuid().safeParse(formData.get("requestId"));
  if (!requestId.success) redirect("/requests?error=refused");
  try {
    await reprocessRequest({ tenancy: getRuntime().tenancy, boss: await getJobClient() }, actor, requestId.data);
    drainAfterResponse(); // serverless runtimes only (JOB_DRAIN_INLINE=true): retry right away
  } catch (error) {
    if (error instanceof ReprocessRefused || error instanceof AuthorizationError) redirect("/requests?error=refused");
    throw error;
  }
  redirect("/requests?done=reprocessed");
}
