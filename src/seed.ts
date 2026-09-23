// Demo seed (`pnpm seed:demo`, local only): two synthetic companies, each with an admin, and a clerk
// in the first one. It uses the real path – company + invitation, then sign-up – no bypass.
// All names and addresses are synthetic (example.com). Passwords come from SEED_PASSWORD.
import { eq } from "drizzle-orm";
import { loadConfig } from "@/config/env";
import { createDatabase } from "@/db";
import * as schema from "@/db/schema";
import { bootstrapCompany, createAuth, getActor, inviteUser } from "@/features/identity";

const COMPANIES = [
  { name: "Musterbau Beispiel GmbH", slug: "musterbau", admin: "admin@musterbau.example.com", clerk: "sachbearbeitung@musterbau.example.com" },
  { name: "Beispielwerk Nord AG", slug: "beispielwerk", admin: "admin@beispielwerk.example.com" },
];

async function main(): Promise<void> {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error("SEED_PASSWORD (at least 12 characters) is required");
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl, { max: 2 });
  const auth = createAuth(database.db, config.auth);
  const signUp = (email: string, name: string) => auth.api.signUpEmail({ body: { email, password, name } });
  try {
    for (const company of COMPANIES) {
      const [existing] = await database.db.select().from(schema.organization).where(eq(schema.organization.slug, company.slug));
      if (existing) {
        console.log(`skip ${company.slug}: exists`);
        continue;
      }
      await bootstrapCompany(database.db, { name: company.name, slug: company.slug, adminEmail: company.admin });
      await signUp(company.admin, "Demo Admin");
      if (company.clerk) {
        const login = await auth.api.signInEmail({ body: { email: company.admin, password }, returnHeaders: true });
        const cookie = login.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");
        const admin = await getActor(auth, database.db, new Headers({ cookie }));
        if (!admin) throw new Error("seeded admin has no company");
        await inviteUser(database.db, admin, { email: company.clerk, role: "clerk" });
        await signUp(company.clerk, "Demo Sachbearbeitung");
      }
      console.log(`seeded ${company.slug}`);
    }
  } finally {
    await database.pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "seed failed");
  process.exit(1);
});
