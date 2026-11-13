import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDatabaseUrl } from "../src/lib/core/db-url.ts";
import pgcs from "pg-connection-string";

const HOST = "aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const parsed = (raw: string) => pgcs.parse(normalizeDatabaseUrl(raw));

test("passwords with URL special characters are encoded and survive parsing", () => {
  for (const pw of ["pa#ss", "a/b?c", "p@ss@word", "100%sure", "x:y", "spa ce"]) {
    const c = parsed(`postgresql://postgres.abc:${pw}@${HOST}`);
    assert.equal(c.password, pw, pw);
    assert.equal(c.host, "aws-0-us-east-1.pooler.supabase.com");
    assert.equal(c.user, "postgres.abc");
    assert.equal(c.database, "postgres");
  }
});

test("already-encoded passwords are left alone", () => {
  assert.equal(parsed(`postgresql://postgres.abc:pa%23ss@${HOST}`).password, "pa#ss");
});

test("placeholder brackets, quotes and a pasted variable name are removed", () => {
  assert.equal(parsed(`postgresql://postgres.abc:[secret#1]@${HOST}`).password, "secret#1");
  assert.equal(parsed(`"postgresql://postgres.abc:secret@${HOST}"`).password, "secret");
  assert.equal(parsed(`DATABASE_URL=postgresql://postgres.abc:secret@${HOST}`).password, "secret");
});

test("Supabase gets encrypted connections without strict CA checks", () => {
  const c = parsed(`postgresql://postgres.abc:secret@${HOST}`);
  assert.deepEqual(c.ssl, { rejectUnauthorized: false });
  assert.equal(pgcs.parse(normalizeDatabaseUrl("postgres://u:p@localhost:5432/db?sslmode=disable")).ssl, false);
});

test("hopeless values get a clear message instead of 'Invalid URL'", () => {
  assert.throws(() => normalizeDatabaseUrl("not a url"), /DATABASE_URL is not a valid Postgres connection string/);
});
