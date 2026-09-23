// Fixture: deep import across modules through the "@/" alias.
import { secret } from "@/features/beta/internal";

export const leaked = secret;
