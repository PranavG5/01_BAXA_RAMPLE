# Rample Video Studio

The MVP video pipeline from **PRD: Rample.ai Video Marketing Pipeline (v2)**. A salon or barbershop owner types one line ("$25 Tuesday Fade special"), reviews a storyboard built from photos of their own shop, approves it, and gets a QA-checked 9:16 video for Instagram Reels and TikTok.

Next.js 16, Postgres (hosted, or embedded PGlite locally) with Vercel Blob or local file storage, Claude for every reasoning step, Higgsfield and Pika for image-to-video, Shotstack for assembly, ElevenLabs for voiceover.

```
Photo library ─► Improve prompt ─► Draft storyboard ─► Route models ─► Owner approves? ──no──► revise (new version)
  + profile        (Claude)          (Claude)          (Claude + registry)      │yes
                                                                                ▼
Dashboard ◄─yes─ Final QA ◄─ Assembly (Shotstack) ◄─ Scene QA ◄─ Render queue (one job per scene)
   + export          │no                                  │fail        ▲
                     ▼                                    ▼            │ retry (fallback model on the last try)
                 reassemble once ─► human review     retry scene ──────┘ ─► still failing ─► human review
```

## What is in the box

| Area | Where |
|---|---|
| Photo onboarding, consent, Claude vision tagging, shot checklist, 6-photo / 4-area minimum | `src/app/(app)/library`, `src/lib/server/pipeline/assets.ts`, `src/lib/server/ai/tagging.ts`, `src/lib/core/library.ts` |
| Business profile (services, prices, brand colors, logo, tone, booking link) | `src/app/(app)/profile`, `src/app/api/profile` |
| Prompt improvement with at most one clarifying question and a fact guard against invented prices/days | `src/lib/server/ai/brief.ts`, `src/lib/core/facts.ts` |
| Storyboard (Hook, Showcase, Proof, CTA), schema-validated with retries, every scene anchored to a real photo | `src/lib/server/ai/storyboard.ts`, `src/lib/core/storyboard-rules.ts` |
| Versioned edits by chat or inline; only changed scenes are re-routed and re-rendered | `src/lib/server/pipeline/projects.ts` (`renderKey`) |
| Free preview with photos and text overlays (no credits) | `src/components/workspace/PreviewPlayer.tsx` |
| Model registry, Claude router, server-side pick validation, pins, kill switch, staleness flags | `src/lib/server/ai/router.ts`, `src/lib/core/routing-rules.ts`, `src/app/(app)/ops/registry` |
| Approval gate and credit cap, enforced **in Postgres** (trigger + `claim_render_job`) | `db/migrations/0001_init.sql` |
| Provider adapter (submit, poll/webhook, cancel, cost) for Higgsfield and Pika | `src/lib/server/providers/*` |
| Render queue with idempotency keys, retries, fallback model, per-project lock | `src/lib/server/pipeline/render.ts` |
| Scene QA: sampled frames scored by Claude + pixel fidelity vs. source photo; final QA: duration, 1080x1920, audio level | `src/lib/server/ai/qa.ts`, `src/lib/core/pipeline-rules.ts` |
| Deterministic assembly: text, prices and logos only ever added here | `src/lib/core/timeline.ts`, `src/lib/server/media/shotstack.ts` |
| Human review queue (approve, reject, re-render with another model) and router grading | `src/app/(app)/ops/review` |
| Dashboard of QA-passed videos, export, delete, AI-disclosure guidance | `src/app/(app)/dashboard` |
| Success metrics from PRD section 10 | `src/app/(app)/ops/metrics`, `src/lib/server/pipeline/metrics.ts` |
| Audit trail of every version, approval, router decision, job and QA result | `audit_events` + the tables themselves |

Automatic Mode (FR-31, P2) is a placeholder page in the Marketing tab, as the PRD defers it until the PM defines it.

## Setup

### 1. Storage

**On Vercel**, connect two stores under **Project > Storage**, then redeploy:

- A **Postgres database** (Neon, Supabase or any Postgres 13+). Vercel sets `DATABASE_URL` or `POSTGRES_URL`.
- A **Blob store** for photos and videos. Vercel sets `BLOB_READ_WRITE_TOKEN`. Files are stored privately and served through short-lived signed `/api/files` links.

The app runs `db/migrations/*.sql` on first use. Without these stores, Vercel only offers `/tmp`, which belongs to a single server instance: an upload lands on one instance and the next page is often served by another, so photos seem to disappear. The app shows a red banner when this is the case.

**Using Supabase for the database:** create a Supabase project, click **Connect**, copy the **Transaction pooler** connection string (port 6543, works from Vercel), put your database password in it, and add it in Vercel as `DATABASE_URL`. The app handles Supabase's SSL and turns on row-level security for every table, so Supabase's public Data API cannot read them (the app connects as the table owner and is unaffected). Use a fresh project: the app creates its own tables.

**On your own machine** nothing is needed: the app creates an embedded Postgres (PGlite) and a file store in `DATA_DIR` (default `./.data`). Set `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` locally to use the hosted stores instead.

### 2. Vercel

1. Import this repository in Vercel (framework preset: Next.js).
2. Add every variable from `.env.example` under **Settings > Environment Variables**. At minimum: `ANTHROPIC_API_KEY`, `HIGGSFIELD_*` and/or `PIKA_API_KEY`, `SHOTSTACK_API_KEY`, `ELEVENLABS_API_KEY`, `CRON_SECRET`.
3. Deploy and sign in with the single admin account:

   - Email: `test@rample.ai`
   - Password: `baxatest`

   This account owns the business and also sees the Review, Registry and Metrics pages. There is no sign-up. The credentials are hardcoded in `src/lib/server/auth.ts`.

The included `vercel.json` cron runs a daily safety sweep (Hobby plans allow daily crons). The pipeline is mainly driven by the project page polling every 4 seconds and by provider/Shotstack webhooks, so it does not depend on the cron. On a Pro plan you can change the schedule to `* * * * *`.

### 3. Local development

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Set `MEDIA_MODE=mock` to try the full flow without spending video, voice or assembly credits: video clips are generated from your photo with an ffmpeg zoom, voiceover is a tone, and assembly concatenates scenes (no text overlays). Claude still runs, so `ANTHROPIC_API_KEY` is required.

### Tests

```bash
npm test
```

Unit tests for the storyboard rules, router constraints, retry policy, QA verdicts, fact guard, library minimum and the Shotstack timeline.

`npm test` also runs `tests/db_gates.mjs`: database tests for the approval gate, the credit cap, frozen approved versions and the project lock, on a throwaway embedded Postgres.

## How the hard gates work

- **No credits before approval.** `render_jobs` has a `BEFORE INSERT` trigger that rejects any job whose storyboard version is not approved. Before a job is sent to a provider, `claim_render_job()` re-checks approval and the per-project credit cap inside a row lock, so concurrent workers cannot overspend. Claude never receives a tool or key that can submit renders: it sees registry data as plain text during routing.
- **Approved versions are frozen.** A trigger blocks edits to scenes in an approved version; every change creates a new version.
- **Nothing glitchy reaches the dashboard.** The dashboard query only returns `final_videos.status = 'passed'`, which is set by final QA or a human reviewer.

## Model registry

The seed registry (`0002_seed_registry.sql`) contains seven image-to-video models whose request schemas and prices were taken from the provider docs in November 2026:

- **Pika** (`api.dev.pika.art`): Pika H3 Flex, Pika 2.5, Kling 3.0.
- **Higgsfield** (`api.higgsfield.ai`): Seedance 2.5, Wan 2.7, Kling 2.5 Turbo Pro, Hailuo 2.3.

Every seed is marked "usable with caveats" with no evaluation date, so the registry page flags all of them for re-evaluation until the UI/UX team records real results (Appendix A). The `best_for` / `avoid_for` tags are starting guesses. Higgsfield does not publish per-model prices in its docs, so those costs are estimates to confirm in the Higgsfield console. Note: Pika's older models on fal.ai (`fal-ai/pika/v2.2/...`) were retired on 2026-10-29; this app uses Pika's own API.

Each entry's `request_config` maps the scene onto that model's field names (`image_url` vs `image`, `duration` vs `duration_s`, static extras like `generate_audio: false`), so adding a model is a registry edit, not a code change.

## Decisions on the PRD's open questions

These are the defaults this build uses. Each is a small change if the team decides otherwise.

| Open question (11.2) | Default in this build |
|---|---|
| Provider connection: MCP or direct API? | Direct REST APIs from the server, behind one adapter interface. Claude only gets read-only registry data. |
| Start-image support | Only `start_image_support = true` models are routable. Every start image is the owner's photo cropped to 1080x1920. |
| Voiceover and music | ElevenLabs per scene; music from licensed URLs you configure (`MUSIC_URL` or `MUSIC_TRACKS`). |
| Storage | Hosted Postgres plus private Vercel Blob in production; embedded Postgres and local files for local development. |
| Cost ownership / target cost | Per-video credit cap (default 300 credits = $3), editable per business and per project. |
| Failed renders | Credits for failed jobs count against the cap; failures retry up to 3 attempts, the last on the fallback model, then go to human review. |
| Model visibility | Owners see "AI-animated" / "Photo motion" badges; the model name and router reason are behind a "why" link. |
| Disclosure | Guidance panel on the dashboard pointing to Instagram's AI label and TikTok's AI-generated content setting. |
| Automatic Mode | Placeholder page only (P2). |
