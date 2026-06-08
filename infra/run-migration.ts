/**
 * Run the Aurora schema migration via the RDS Data API.
 *
 * The Data API executes one statement per call, so we split the migration file
 * on statement boundaries (the SQL contains no semicolons inside literals).
 *
 * Usage:  pnpm infra:migrate   (or  pnpm --filter @entangle/infra migrate)
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { exec, AURORA } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const file = join(__dirname, "migrations", "001_init.sql");
  const raw = await readFile(file, "utf8");

  const statements = raw
    .split(";")
    .map((s) => s.trim())
    // Drop empty fragments and comment-only fragments.
    .filter((s) => s.length > 0 && !s.split("\n").every((l) => l.trim().startsWith("--")));

  console.log(`==> Applying ${statements.length} statements to ${AURORA.database()} ...`);

  for (const [i, stmt] of statements.entries()) {
    const preview = stmt.replace(/\s+/g, " ").slice(0, 70);
    try {
      await exec(stmt + ";");
      console.log(`  ✓ [${i + 1}/${statements.length}] ${preview}…`);
    } catch (err) {
      console.error(`  ✗ [${i + 1}/${statements.length}] ${preview}…`);
      throw err;
    }
  }

  console.log("==> Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
