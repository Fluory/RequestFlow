// Prepared samples (`pnpm seed:samples`, #71): per demo company one sample to review and one approved and
// exported sample (the ERP must be reachable, else its export is queued). Idempotent – safe to repeat, e.g. after visitors
// decided the samples. The extraction replays recorded answers (src/features/samples); no model call.
// Needs the demo companies (`pnpm seed:demo`) and the same shell variables (runbook §6).
import { loadConfig } from "@/config/env";
import { createDatabase } from "@/db";
import { createJobQueue } from "@/db/job-queue-client";
import { createErpClient } from "@/features/export";
import { createAuth, getActor } from "@/features/identity";
import { currentFieldValues, currentLineItemValues } from "@/features/review";
import { seedSamples } from "@/features/samples";
import { S3BlobStore } from "@/features/storage";
import { createTenancy } from "@/features/tenancy";

const ADMINS = ["admin@musterbau.example.com", "admin@beispielwerk.example.com"];

async function main(): Promise<void> {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error("SEED_PASSWORD is required (the demo admins sign in to seed their company)");
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl, { max: 2 });
  const auth = createAuth(database.db, config.auth);
  const storage = new S3BlobStore(config.storage);
  const boss = await createJobQueue(config.databaseUrl);
  // No hourly upload cap: seeding is an operator step, and a sample never calls the model.
  const tenancy = createTenancy(database.db);
  const deps = {
    tenancy,
    storage,
    boss,
    limits: { ...config.upload, maxPerHour: undefined },
    // The exported sample goes to the configured ERP (on the showcase: the ERP mock route) right away.
    export: { tenancy, erp: createErpClient(config.erp), fieldValues: currentFieldValues, lineItemValues: currentLineItemValues },
  };
  try {
    for (const email of ADMINS) {
      const login = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
      const cookie = login.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");
      const actor = await getActor(auth, database.db, new Headers({ cookie }));
      if (!actor) throw new Error(`${email} has no company – run pnpm seed:demo first`);
      const { seeded, retired } = await seedSamples(deps, actor);
      if (retired > 0) console.log(`${email}: ${retired} leftover sample(s) of an aborted run rejected`);
      console.log(seeded.length === 0 ? `${email}: samples still in place` : `${email}: ${seeded.map((sample) => `${sample.key} → ${sample.status}`).join(", ")}`);
    }
  } finally {
    await boss.stop({ graceful: true });
    storage.destroy();
    await database.pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "seeding samples failed");
  process.exit(1);
});
