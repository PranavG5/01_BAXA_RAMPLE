// Photo library readiness (FR-3, PRD 3.1).
import { LIBRARY_MINIMUM, REQUIRED_SHOTS } from "./vocabulary.ts";

export interface LibraryAssetStatus {
  id: string;
  area: string | null;
  shot_slot: string | null;
  usable: boolean;
  tag_status: string;
}

export interface LibraryReadiness {
  slots: { slot: string; label: string; hint: string; filled: boolean; count: number; needsConsent?: boolean }[];
  taggedUsable: number;
  distinctAreas: number;
  pendingTags: number;
  ready: boolean;
  missing: string[];
}

export function libraryReadiness(assets: LibraryAssetStatus[]): LibraryReadiness {
  const tagged = assets.filter((a) => a.tag_status === "tagged" && a.usable);
  const areas = new Set(tagged.map((a) => a.area).filter((a): a is string => !!a && a !== "other"));
  const slots = REQUIRED_SHOTS.map((r) => {
    const count = tagged.filter((a) => a.shot_slot === r.slot || a.area === r.slot).length;
    return { ...r, filled: count > 0, count };
  });
  const missing: string[] = [];
  if (tagged.length < LIBRARY_MINIMUM.photos) {
    missing.push(`${LIBRARY_MINIMUM.photos - tagged.length} more usable photo(s)`);
  }
  if (areas.size < LIBRARY_MINIMUM.areas) {
    missing.push(`${LIBRARY_MINIMUM.areas - areas.size} more distinct area(s) of the shop`);
  }
  return {
    slots,
    taggedUsable: tagged.length,
    distinctAreas: areas.size,
    pendingTags: assets.filter((a) => a.tag_status === "pending").length,
    ready: missing.length === 0,
    missing,
  };
}
