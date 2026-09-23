// Fixture: a feature module reaching for the raw database client (forbidden, ADR-0001 D7).
import pg from "pg";

export const pool = new pg.Pool();
