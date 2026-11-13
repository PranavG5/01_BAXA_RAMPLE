import "server-only";

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export interface MusicTrack {
  mood: string;
  url: string;
  license: string;
}

function parseMusic(): MusicTrack[] {
  const raw = read("MUSIC_TRACKS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as MusicTrack[];
      if (Array.isArray(parsed)) return parsed.filter((t) => t && typeof t.url === "string");
    } catch {
      console.warn("MUSIC_TRACKS is not valid JSON; ignoring it.");
    }
  }
  const single = read("MUSIC_URL");
  return single ? [{ mood: "default", url: single, license: read("MUSIC_LICENSE") ?? "owner-supplied" }] : [];
}

/**
 * Higgsfield auth is "<key id>:<key secret>". Accepts the names in .env.example
 * plus the ones Higgsfield's own SDK uses (HF_KEY, HF_API_KEY + HF_API_SECRET),
 * and a single HIGGSFIELD_API_KEY holding "id:secret". When something is
 * missing, `problem` says what, for the registry page badge.
 */
function higgsfieldKey(): { credentials?: string; problem?: string } {
  const first = (...names: string[]) => names.map(read).find(Boolean);
  const combined = first("HIGGSFIELD_CREDENTIALS", "HF_KEY", "HF_CREDENTIALS");
  if (combined) return combined.includes(":") ? { credentials: combined } : { problem: "key must be id:secret" };
  const single = first("HIGGSFIELD_API_KEY", "HIGGSFIELD_KEY");
  if (single?.includes(":")) return { credentials: single };
  const id = first("HIGGSFIELD_API_KEY_ID", "HIGGSFIELD_KEY_ID", "HF_API_KEY") ?? single;
  const secret = first("HIGGSFIELD_API_KEY_SECRET", "HIGGSFIELD_API_SECRET", "HIGGSFIELD_SECRET", "HF_API_SECRET");
  if (id && secret) return { credentials: `${id}:${secret}` };
  if (id) return { problem: "secret missing" };
  if (secret) return { problem: "key id missing" };
  return { problem: "no key" };
}

export const env = {
  anthropicModel: () => read("ANTHROPIC_MODEL") ?? "claude-opus-5-5",
  anthropicQaModel: () => read("ANTHROPIC_QA_MODEL") ?? read("ANTHROPIC_MODEL") ?? "claude-opus-5-5",

  higgsfieldBaseUrl: () => read("HIGGSFIELD_BASE_URL") ?? "https://api.higgsfield.ai",
  higgsfieldCredentials: () => higgsfieldKey().credentials,
  higgsfieldKey,
  higgsfieldWebhookSecret: () => read("HIGGSFIELD_WEBHOOK_SECRET"),

  pikaBaseUrl: () => read("PIKA_BASE_URL") ?? "https://api.dev.pika.art",
  pikaApiKey: () => read("PIKA_API_KEY"),
  pikaWebhookSecret: () => read("PIKA_WEBHOOK_SECRET"),

  shotstackApiKey: () => read("SHOTSTACK_API_KEY"),
  shotstackEnv: () => (read("SHOTSTACK_ENV") === "stage" ? "stage" : "v1"),
  shotstackFont: () => read("SHOTSTACK_FONT") ?? "Open Sans",

  elevenLabsApiKey: () => read("ELEVENLABS_API_KEY"),
  elevenLabsVoiceId: () => read("ELEVENLABS_VOICE_ID") ?? "21m00Tcm4TlvDq8ikWAM",
  elevenLabsModelId: () => read("ELEVENLABS_MODEL_ID") ?? "eleven_multilingual_v2",

  /** "mock" swaps video providers, voiceover and assembly for local ffmpeg stand-ins (no credits). */
  mediaMode: () => (read("MEDIA_MODE") === "mock" ? "mock" : "live"),
  appUrl: () => (read("APP_URL") ?? (read("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${read("VERCEL_PROJECT_PRODUCTION_URL")}` : undefined))?.replace(/\/$/, ""),
  cronSecret: () => read("CRON_SECRET"),
  musicTracks: parseMusic,
  defaultCreditCap: () => Number(read("DEFAULT_CREDIT_CAP") ?? 5000),
};
