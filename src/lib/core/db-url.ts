/**
 * Cleans up a pasted Postgres connection string so it parses, and gives
 * sslmode its usual libpq meaning.
 *
 * Repairs the usual copy-paste problems: surrounding quotes or a leading
 * "DATABASE_URL=", the [YOUR-PASSWORD] brackets left around the password,
 * and passwords with characters such as # / ? % @ that must be
 * percent-encoded in a URL.
 *
 * node-postgres treats sslmode=require as full certificate checking, which
 * fails on hosts with their own CA such as Supabase; uselibpqcompat makes it
 * mean "encrypted" as in libpq. Supabase URLs without sslmode get require.
 */
export function normalizeDatabaseUrl(raw: string): string {
  let url = raw.trim().replace(/^(?:DATABASE_URL|POSTGRES_URL)\s*=\s*/, "");
  if (/^(["']).*\1$/.test(url)) url = url.slice(1, -1).trim();

  // user:password@host, with the password running to the LAST "@" before the host.
  const m = url.match(/^(postgres(?:ql)?:\/\/)([^:@/\s]+):(.*)@([^@/?#\s]+)(\/[^?#\s]*)?(\?[^#\s]*)?$/);
  if (m) {
    const [, scheme, user, rawPassword, host, path = "", query = ""] = m;
    let password = rawPassword;
    if (/^\[.*\]$/.test(password)) password = password.slice(1, -1);
    url = `${scheme}${user}:${encodeOnce(password)}@${host}${path}${query}`;
  }

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(
      "DATABASE_URL is not a valid Postgres connection string. Copy it again from Supabase > Connect > Transaction pooler, replace [YOUR-PASSWORD] (brackets included) with your database password, and redeploy.",
    );
  }
  const q = u.searchParams;
  if (!q.has("sslmode") && /(^|\.)supabase\.(co|com)$/.test(u.hostname)) q.set("sslmode", "require");
  if (q.has("sslmode") && !q.has("uselibpqcompat")) q.set("uselibpqcompat", "true");
  return u.toString();
}

/** Percent-encodes a URL part unless it is already encoded. */
function encodeOnce(part: string): string {
  try {
    if (encodeURIComponent(decodeURIComponent(part)) === part) return part;
  } catch {
    // a lone "%": not encoded yet
  }
  return encodeURIComponent(part);
}
