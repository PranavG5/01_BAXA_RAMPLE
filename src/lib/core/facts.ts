// Guard against invented offers (PRD 6.1 rules, risk "prompt improvement invents
// offers or claims"): every price, percentage, time and weekday in Claude's
// output must appear in the owner's prompt, the clarifying answer or the profile.

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function extractClaims(text: string): string[] {
  const claims = new Set<string>();
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/\$\s?\d+(?:[.,]\d{1,2})?/g)) claims.add(m[0].replace(/\s/g, ""));
  for (const m of lower.matchAll(/\b\d{1,3}\s?%/g)) claims.add(m[0].replace(/\s/g, ""));
  for (const m of lower.matchAll(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/g)) claims.add(m[0].replace(/\s/g, ""));
  for (const d of WEEKDAYS) if (new RegExp(`\\b${d}s?\\b`).test(lower)) claims.add(d);
  for (const m of lower.matchAll(/\b(\d+)\s?(?:off|percent)\b/g)) claims.add(m[1]);
  return [...claims];
}

function normalizeSource(text: string): string {
  return text.toLowerCase().replace(/\s/g, "");
}

/** Returns claims from `generated` that are not supported by any source text. */
export function unsupportedClaims(generated: string, sources: string[]): string[] {
  const src = normalizeSource(sources.join(" \n "));
  const srcLower = sources.join(" \n ").toLowerCase();
  return extractClaims(generated).filter((c) => {
    if (WEEKDAYS.includes(c)) return !new RegExp(`\\b${c.slice(0, 3)}`).test(srcLower);
    if (src.includes(c)) return false;
    // "$25" is supported by "25 dollars"; "$25.00" by "$25". Digits must not be part of a longer number.
    const bare = c.replace(/^\$/, "").replace(/[.,]00$/, "");
    const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (/^\d/.test(bare) && new RegExp(`(^|[^\\d.,])${escaped}([^\\d]|$)`).test(src)) return false;
    return true;
  });
}
