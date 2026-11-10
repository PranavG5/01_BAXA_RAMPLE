/**
 * FR-30: guidance on AI-content disclosure. Platform rules change, so the copy
 * points owners to the platform's current setting rather than quoting policy.
 */
export function DisclosureGuide() {
  return (
    <details className="rounded-xl border border-line bg-canvas p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Posting tip: label AI-generated content</summary>
      <div className="mt-3 space-y-2 text-muted">
        <p>Parts of this video were animated by AI from your photos. Instagram and TikTok ask creators to label realistic AI-generated or AI-edited content.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b className="text-ink">Instagram Reels:</b> before sharing, open the advanced or more options and turn on the AI label (Meta shows it as “AI info”).</li>
          <li><b className="text-ink">TikTok:</b> before posting, open more options and turn on the “AI-generated content” setting.</li>
          <li>Prices and offers in the video come from your profile and request. Double-check them before posting.</li>
        </ul>
        <p className="text-xs">Platform rules change. Check each app’s current help pages if a setting has moved.</p>
      </div>
    </details>
  );
}
