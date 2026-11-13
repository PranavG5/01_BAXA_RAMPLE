import "server-only";
import {
  draftFromSchema,
  higgsfieldEntries,
  parseHiggsfieldDocs,
  parsePikaCatalog,
  pikaDocsUrl,
  type CatalogDraft,
  type CatalogEntry,
  type CatalogProvider,
  type HiggsfieldModel,
  type PikaApi,
} from "../../core/catalog";
import { env } from "../env";

/**
 * Fetches the provider catalogs: Pika's public catalog API (no key needed)
 * and Higgsfield's model docs, which carry every endpoint's input schema.
 * Cached per server instance for a few hours.
 */
const TTL_MS = 6 * 3600_000;
const HIGGSFIELD_DOCS = "https://docs.higgsfield.ai/llms-full.txt";

interface Cached<T> {
  at: number;
  value: Promise<T>;
}
const cache = globalThis as unknown as {
  __rampleCatalog?: { pika?: Cached<CatalogEntry[]>; higgsfield?: Cached<HiggsfieldModel[]>; pikaDetail?: Map<string, Cached<PikaApi>> };
};
const store = (cache.__rampleCatalog ??= {});

function cached<T>(slot: Cached<T> | undefined, load: () => Promise<T>, set: (c: Cached<T>) => void): Promise<T> {
  if (slot && Date.now() - slot.at < TTL_MS) return slot.value;
  const value = load();
  const entry = { at: Date.now(), value };
  set(entry);
  value.catch(() => set({ at: 0, value })); // retry on the next call after a failure
  return value;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

function pikaList() {
  return cached(store.pika, async () => parsePikaCatalog(await getJson<{ apis?: PikaApi[] }>(`${env.pikaBaseUrl()}/catalog/apis`)), (c) => (store.pika = c));
}

function higgsfieldModels() {
  return cached(
    store.higgsfield,
    async () => {
      const res = await fetch(HIGGSFIELD_DOCS, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
      if (!res.ok) throw new Error(`docs.higgsfield.ai answered ${res.status}`);
      const models = parseHiggsfieldDocs(await res.text());
      if (!models.length) throw new Error("Higgsfield docs had no model pages (their format may have changed).");
      return models;
    },
    (c) => (store.higgsfield = c),
  );
}

function pikaDetail(apiId: string) {
  store.pikaDetail ??= new Map();
  return cached(
    store.pikaDetail.get(apiId),
    () => getJson<PikaApi>(`${env.pikaBaseUrl()}/catalog/apis/${apiId}?expand=inputs`),
    (c) => store.pikaDetail!.set(apiId, c),
  );
}

/** Every video model both providers list. A provider that cannot be reached is reported, not fatal. */
export async function loadCatalog(): Promise<{ entries: CatalogEntry[]; errors: string[] }> {
  const [pika, hf] = await Promise.allSettled([pikaList(), higgsfieldModels()]);
  const errors: string[] = [];
  const entries: CatalogEntry[] = [];
  if (pika.status === "fulfilled") entries.push(...pika.value);
  else errors.push(`Pika catalog unavailable: ${pika.reason instanceof Error ? pika.reason.message : String(pika.reason)}`);
  if (hf.status === "fulfilled") entries.push(...higgsfieldEntries(hf.value));
  else errors.push(`Higgsfield catalog unavailable: ${hf.reason instanceof Error ? hf.reason.message : String(hf.reason)}`);
  return { entries, errors };
}

/** A registry entry pre-filled from the model's own input schema and pricing. */
export async function draftFor(provider: CatalogProvider, endpoint: string): Promise<CatalogDraft | null> {
  if (!/^[\w.\-/]+$/.test(endpoint)) return null;
  if (provider === "pika") {
    const known = (await pikaList()).find((e) => e.endpoint === endpoint);
    if (!known) return null;
    const detail = await pikaDetail(endpoint);
    return draftFromSchema({
      provider,
      endpoint,
      name: detail.name ?? known.name,
      docsUrl: pikaDocsUrl(endpoint),
      schema: detail.input_schema ?? null,
      pricing: detail.display_pricing,
    });
  }
  const model = (await higgsfieldModels()).find((m) => m.endpoint === endpoint);
  if (!model) return null;
  return draftFromSchema({ provider, endpoint, name: model.name, docsUrl: model.docsUrl, schema: model.schema });
}
