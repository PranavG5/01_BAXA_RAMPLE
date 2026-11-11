// Runs the database gate tests on a throwaway in-memory PGlite.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const pg = await PGlite.create();
for (const f of readdirSync("db/migrations").sort()) await pg.exec(readFileSync(`db/migrations/${f}`, "utf8"));
const notices = [];
const res = await pg.exec(readFileSync("tests/db_gates.sql", "utf8"), { onNotice: (n) => notices.push(n.message) });
const ok = notices.filter((m) => m.startsWith("ok:"));
console.log(ok.join("\n"));
if (ok.length !== 4) {
  console.error("Expected 4 passing checks", notices);
  process.exit(1);
}
