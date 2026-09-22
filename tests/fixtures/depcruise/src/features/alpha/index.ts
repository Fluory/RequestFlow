// Fixture for tests/architecture/dependency-rules.test.ts – deliberately violates the module boundary.
import { secret } from "../beta/internal";

export const leaked = secret;
