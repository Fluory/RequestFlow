// Fixture: a feature opening its own database connection (forbidden).
import { createDatabase } from "../../db/client";

export const handle = createDatabase();
