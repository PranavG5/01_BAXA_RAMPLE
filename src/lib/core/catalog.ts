import type { RegistryModel, RequestConfig } from "./routing-rules.ts";

/**
 * Provider model catalogs (Pika's public catalog API and Higgsfield's model
 * docs), and turning one model's input schema into a registry draft so ops
 * can add a model by picking it instead of typing endpoints and field names.
 * Pure functions: fetching lives in server/providers/catalog.ts.
 */

export type CatalogProvider = "pika" | "higgsfield";

export interface CatalogEntry {
  provider: CatalogProvider;
  endpoint: string;
  name: string;
  vendor: string;
  /** What the operation does, e.g. "image-to-video". */
  kind: string;
  /** Whether it takes a start image. Null when unknown until the schema is read. */
  startImage: boolean | null;
  /** Lowest listed price in credits per second (1 credit = $0.01), when the provider publishes one. */
  fromCreditsPerSecond: number | null;
  docsUrl: string;
}

export type RegistryDraft = Omit<RegistryModel, "registry_version">;

export interface CatalogDraft {
  model: RegistryDraft;
  /** Things a person must check before saving. */
  warnings: string[];
}

type Json = Record<string, unknown>;
type Schema = { properties?: Record<string, Json>; required?: string[] };

// ---------- Pika ----------

interface PikaPriceTier {
  spec?: Record<string, unknown>;
  micro_usd?: number;
}
interface PikaPricing {
  components?: { role?: string; unit?: { type?: string; quantity?: number }; starting_at?: PikaPriceTier; price_tiers?: PikaPriceTier[] }[];
}
export interface PikaApi {
  api_id: string;
  vendor?: string;
  function?: string;
  category?: string;
  name?: string;
  display_pricing?: PikaPricing | null;
  input_schema?: Schema;
}

export function pikaDocsUrl(apiId: string) {
  return `https://dev.pika.art/models/${apiId}`;
}

export function parsePikaCatalog(json: { apis?: PikaApi[] }): CatalogEntry[] {
  return (json.apis ?? [])
    .filter((a) => a.category === "video" && a.api_id)
    .map((a) => ({
      provider: "pika" as const,
      endpoint: a.api_id,
      name: a.name ?? a.api_id,
      vendor: a.vendor ?? a.api_id.split("/")[0],
      kind: a.function ?? a.api_id.split("/").pop() ?? "",
      startImage: a.function === "image-to-video" ? true : a.function === "text-to-video" ? false : null,
      fromCreditsPerSecond: pikaCreditsPerSecond(a.display_pricing, null),
      docsUrl: pikaDocsUrl(a.api_id),
    }));
}

/** Output price per second in credits, at the given resolution when tiers differ. Null when not per-time. */
export function pikaCreditsPerSecond(pricing: PikaPricing | null | undefined, resolution: string | null): number | null {
  const out = pricing?.components?.find((c) => c.role === "output");
  if (!out?.unit?.type) return null;
  const tiers = out.price_tiers?.length ? out.price_tiers : out.starting_at ? [out.starting_at] : [];
  const audioOff = (t: PikaPriceTier) => t.spec?.audio === undefined || t.spec.audio === false || t.spec.audio === "off";
  const res = resolution?.toLowerCase();
  const pick =
    (res && tiers.find((t) => String(t.spec?.resolution ?? "").toLowerCase() === res && audioOff(t))) ||
    (res && tiers.find((t) => String(t.spec?.resolution ?? "").toLowerCase() === res)) ||
    tiers.find(audioOff) ||
    out.starting_at ||
    tiers[0];
  if (!pick?.micro_usd) return null;
  const perUnit = pick.micro_usd / (out.unit.quantity || 1);
  let perSecond: number | null = null;
  if (out.unit.type === "second" || out.unit.type === "output_second") perSecond = perUnit;
  else if (out.unit.type === "minute") perSecond = perUnit / 60;
  else if (out.unit.type === "request" && Number(pick.spec?.duration_s) > 0) perSecond = perUnit / Number(pick.spec?.duration_s);
  if (perSecond === null) return null;
  return Math.round((perSecond / 10_000) * 100) / 100; // micro-USD -> credits
}

// ---------- Higgsfield ----------

export interface HiggsfieldModel {
  endpoint: string;
  name: string;
  docsUrl: string;
  schema: Schema | null;
}

/** Reads the model pages out of https://docs.higgsfield.ai/llms-full.txt. */
export function parseHiggsfieldDocs(text: string): HiggsfieldModel[] {
  const heads = [...text.matchAll(/^# (.+)\nSource: (https:\/\/docs\.higgsfield\.ai\/docs\/models\/[^\s]+)/gm)];
  const out: HiggsfieldModel[] = [];
  heads.forEach((h, i) => {
    const page = text.slice(h.index, heads[i + 1]?.index ?? text.length);
    const id = page.match(/\*\*Endpoint ID:\*\* `([^`]+)`/)?.[1];
    if (!id) return;
    let schema: Schema | null = null;
    const block = page.match(/Complete JSON schema\n>\n> ```json[^\n]*\n((?:>.*\n)+?)> ```/);
    if (block) {
      const body = block[1]
        .split("\n")
        .map((l) => (l.startsWith("> ") ? l.slice(2) : l.slice(1)))
        .join("\n");
      try {
        schema = JSON.parse(body) as Schema;
      } catch {
        schema = null;
      }
    }
    if (out.some((m) => m.endpoint === id)) return;
    out.push({ endpoint: id, name: h[1].replace(/\s+API$/, "").replace(/\s+—\s+/, " · ").trim(), docsUrl: h[2], schema });
  });
  return out;
}

export function higgsfieldEntries(models: HiggsfieldModel[]): CatalogEntry[] {
  return models
    .filter((m) => /video/i.test(m.endpoint) || /video/i.test(m.name) || !!m.schema?.properties?.duration)
    .map((m) => ({
      provider: "higgsfield" as const,
      endpoint: m.endpoint,
      name: m.name,
      vendor: m.endpoint.split("/")[0],
      kind: m.endpoint.split("/").pop() ?? "",
      startImage: m.schema ? findImageField(props(m.schema)) !== null : null,
      fromCreditsPerSecond: null,
      docsUrl: m.docsUrl,
    }));
}

// ---------- Schema -> registry draft ----------

/** Collapses `anyOf: [X, null]` so field checks see X. */
function flat(p: Json): Json {
  const any = p.anyOf as Json[] | undefined;
  if (Array.isArray(any)) {
    const real = any.find((x) => x.type !== "null");
    if (real) return { ...p, ...real };
  }
  return p;
}

function props(schema: Schema | null | undefined): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(schema?.properties ?? {})) out[k] = flat(v);
  return out;
}

const IMAGE_FIELDS = ["image_url", "image", "first_frame_url", "first_frame_image", "start_image_url", "start_image", "input_image", "first_frame"];
const DURATION_FIELDS = ["duration", "duration_s", "duration_seconds", "seconds"];
const ASPECT_FIELDS = ["aspect_ratio", "ratio"];
// Switched off so clips stay silent (voiceover and music are added in assembly),
// unbranded, and faithful to the prompt the app wrote.
const OFF_BOOLEANS = ["generate_audio", "audio", "sound", "watermark", "aigc_watermark", "rewrite", "enhance_prompt", "prompt_optimizer", "prompt_extend", "multi_shot", "multi_shots"];
const OFF_ENUMS = ["audio", "sound"];

function findImageField(p: Record<string, Json>): string | null {
  return IMAGE_FIELDS.find((k) => p[k] && p[k].type === "string") ?? null;
}

function enumOf(p: Json | undefined): unknown[] | null {
  return Array.isArray(p?.enum) ? (p.enum as unknown[]) : null;
}

const DEFAULT_GUIDELINES =
  'Describe one simple camera move and one subtle motion. Say "the scene stays exactly as in the photo". Avoid asking for text or new objects.';

export function draftFromSchema(input: {
  provider: CatalogProvider;
  endpoint: string;
  name: string;
  docsUrl: string;
  schema: Schema | null;
  pricing?: PikaPricing | null;
}): CatalogDraft {
  const warnings: string[] = [];
  const p = props(input.schema);
  const required = new Set(input.schema?.required ?? []);
  const handled = new Set<string>();
  const staticFields: Record<string, unknown> = {};
  if (!input.schema) warnings.push("Could not read this model's input schema; check the request mapping against the docs.");

  const image = findImageField(p);
  if (image) handled.add(image);
  else warnings.push("No start-image field: this model cannot animate your photos, so the router will never pick it.");

  const prompt = p.prompt ? "prompt" : null;
  if (prompt) handled.add(prompt);
  else warnings.push("No `prompt` field found; check the request mapping.");

  const negative = p.negative_prompt?.type === "string" ? "negative_prompt" : undefined;
  if (negative) handled.add(negative);

  const durationKey = DURATION_FIELDS.find((k) => p[k]) ?? null;
  let min = 5;
  let max = 5;
  let allowed: number[] | null = null;
  let durationAsString = false;
  if (durationKey) {
    handled.add(durationKey);
    const d = p[durationKey];
    durationAsString = d.type === "string";
    const values = (enumOf(d) ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (values.length) {
      allowed = [...new Set(values)].sort((a, b) => a - b);
      min = allowed[0];
      max = allowed[allowed.length - 1];
    } else {
      const def = Number(d.default);
      min = Number(d.minimum ?? d.exclusiveMinimum ?? (Number.isFinite(def) ? def : 5));
      max = Number(d.maximum ?? d.exclusiveMaximum ?? Math.max(min, Number.isFinite(def) ? def : min));
      if (!Number.isFinite(min) || min <= 0) min = 1;
      if (!Number.isFinite(max) || max < min) max = min;
    }
  } else {
    warnings.push("No duration field: the clip length is fixed by the model. Set min/max seconds to that length.");
  }
  // The registry accepts 0.5-60 s.
  min = Math.min(Math.max(min, 0.5), 60);
  max = Math.min(Math.max(max, min), 60);
  if (allowed) allowed = allowed.filter((n) => n <= 60);
  if (allowed && !allowed.length) allowed = null;

  let aspectRatios = ["follows_input"];
  const aspectKey = ASPECT_FIELDS.find((k) => p[k]);
  if (aspectKey) {
    handled.add(aspectKey);
    const values = enumOf(p[aspectKey]);
    if (!values || values.includes("9:16")) {
      staticFields[aspectKey] = "9:16";
      aspectRatios = ["9:16"];
    } else if (values.includes("adaptive")) {
      staticFields[aspectKey] = "adaptive";
    } else {
      warnings.push(`No 9:16 option for ${aspectKey}; clips will be cropped to vertical in assembly.`);
    }
  }

  let resolution = "720p";
  if (p.resolution) {
    handled.add("resolution");
    const values = (enumOf(p.resolution) ?? []).map(String);
    const preferred = values.find((v) => v.toLowerCase() === "720p") ?? values.find((v) => v.toLowerCase() === "768p");
    const chosen = preferred ?? (p.resolution.default != null ? String(p.resolution.default) : values[0]);
    if (chosen) {
      staticFields.resolution = chosen;
      resolution = chosen.toLowerCase();
    }
  }

  for (const k of OFF_BOOLEANS) {
    if (p[k]?.type === "boolean") {
      staticFields[k] = false;
      handled.add(k);
    }
  }
  for (const k of OFF_ENUMS) {
    if (enumOf(p[k])?.includes("off")) {
      staticFields[k] = "off";
      handled.add(k);
    }
  }

  const missing = [...required].filter((k) => !handled.has(k) && p[k]?.default === undefined);
  if (missing.length) {
    warnings.push(`Requires ${missing.map((k) => `\`${k}\``).join(", ")}, which the app does not fill. Add it to the request mapping, or keep this model marked not usable.`);
  }

  let cost: number | null = null;
  if (input.provider === "pika") {
    cost = pikaCreditsPerSecond(input.pricing, resolution);
    if (cost === null) warnings.push("Pika prices this model per token or per request, not per second. Enter an estimated cost per second.");
  } else {
    warnings.push("Higgsfield does not publish prices in its docs. Confirm the cost per second in the Higgsfield console.");
  }

  const request_config: RequestConfig = {
    image_field: image ?? "image_url",
    prompt_field: prompt ?? "prompt",
    duration_field: durationKey ?? "duration",
    ...(durationAsString ? { duration_as_string: true } : {}),
    ...(negative ? { negative_prompt_field: negative } : {}),
    static: staticFields,
  };

  const usable = !!image && !!prompt && !!durationKey && !missing.length;
  return {
    warnings,
    model: {
      model_id: `${input.provider}:${input.endpoint}`,
      provider: input.provider,
      endpoint: input.endpoint,
      display_name: input.provider === "higgsfield" && !/higgsfield/i.test(input.name) ? `${input.name} (Higgsfield)` : input.name,
      status: usable ? "usable_with_caveats" : "not_usable",
      status_reason: usable ? "Added from the provider catalog; pending UI/UX evaluation." : "Added from the provider catalog; the request mapping needs attention before use.",
      enabled: true,
      pros: "",
      cons: "",
      best_for: [],
      avoid_for: [],
      start_image_support: !!image,
      min_duration_s: min,
      max_duration_s: max,
      allowed_durations: allowed,
      aspect_ratios: aspectRatios,
      resolution,
      cost_credits_per_second: cost ?? 5,
      latency_s: 120,
      prompt_guidelines: DEFAULT_GUIDELINES,
      request_config,
      evidence_links: [input.docsUrl],
      evaluated_on: null,
      evaluator: "catalog import",
    },
  };
}
