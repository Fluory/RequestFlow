// Fixture: a feature opening its own pg-boss pool (forbidden).
import { createJobQueue } from "../../db/job-queue-client";

export const queue = createJobQueue();
