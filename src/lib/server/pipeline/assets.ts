import "server-only";
import { randomUUID } from "node:crypto";
import type { Asset, BusinessProfile } from "../../types";
import { tagPhoto } from "../ai/tagging";
import { processPhoto } from "../media/image";
import { getObject, putObject, removeObjects } from "../storage";
import { db, must } from "../db";
import { HttpError } from "../http";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** FR-1: store the photo and its derived 9:16 start image; tagging runs right after. */
export async function uploadAsset(business: BusinessProfile, file: File, consent: boolean): Promise<Asset> {
  if (!consent) throw new HttpError(400, "Please confirm you have the right to use this photo, including any customer faces.");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "Photos must be 20 MB or smaller.");
  const input = Buffer.from(await file.arrayBuffer());
  let processed;
  try {
    processed = await processPhoto(input);
  } catch (err) {
    throw new HttpError(415, err instanceof Error ? err.message : "Unsupported image.");
  }
  const id = randomUUID();
  const dir = `${business.id}/${id}`;
  await Promise.all([
    putObject("assets", `${dir}/original.jpg`, processed.original, "image/jpeg"),
    putObject("assets", `${dir}/vertical.jpg`, processed.vertical, "image/jpeg"),
    putObject("assets", `${dir}/thumb.jpg`, processed.thumb, "image/jpeg"),
    putObject("assets", `${dir}/analysis.jpg`, processed.analysis, "image/jpeg"),
  ]);
  const row = must(
    await db()
      .from("assets")
      .insert({
        id,
        business_id: business.id,
        storage_path: `${dir}/original.jpg`,
        vertical_path: `${dir}/vertical.jpg`,
        thumb_path: `${dir}/thumb.jpg`,
        original_filename: file.name.slice(0, 200),
        mime: file.type || null,
        width: processed.width,
        height: processed.height,
        orientation: processed.orientation,
        quality_flags: processed.qualityFlags,
        usable: !processed.qualityFlags.includes("low_resolution"),
        consent_confirmed: true,
      })
      .select("*")
      .single(),
    "insert asset",
  );
  return row as Asset;
}

/** FR-2: Claude vision tags area, angle and subject, and flags quality problems. */
export async function tagAsset(assetId: string): Promise<Asset> {
  const asset = must(await db().from("assets").select("*").eq("id", assetId).single(), "load asset") as Asset;
  try {
    const analysisPath = asset.storage_path.replace(/original\.jpg$/, "analysis.jpg");
    const image = await getObject("assets", analysisPath).catch(() => getObject("assets", asset.storage_path));
    const tags = await tagPhoto(image.toString("base64"), {
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      filename: asset.original_filename ?? "",
    });
    const flags = new Set(asset.quality_flags);
    for (const q of tags.quality_issues) flags.add(q);
    if (tags.animation_suitability === "poor") flags.add("poor_for_animation");
    const severe = ["low_resolution", "blurry", "screenshot", "watermark"];
    const usable = ![...flags].some((f) => severe.includes(f));
    const updated = must(
      await db()
        .from("assets")
        .update({
          area: tags.area,
          angle: tags.angle,
          subject: tags.subject,
          description: tags.description,
          shot_slot: tags.shot_slot === "none" ? null : tags.shot_slot,
          tags: tags.suitable_motion_tags,
          people_visible: tags.people_visible,
          faces_visible: tags.faces_visible,
          text_visible: tags.text_visible,
          quality_flags: [...flags],
          usable,
          tag_status: "tagged",
          tag_error: null,
        })
        .eq("id", assetId)
        .select("*")
        .single(),
      "save tags",
    );
    return updated as Asset;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db().from("assets").update({ tag_status: "failed", tag_error: message.slice(0, 500) }).eq("id", assetId);
    throw err;
  }
}

export async function listAssets(businessId: string): Promise<Asset[]> {
  return must(
    await db().from("assets").select("*").eq("business_id", businessId).order("created_at", { ascending: true }),
    "list assets",
  ) as Asset[];
}

/** Owners can delete photos (NFR privacy). Scenes that used it lose their background and must be re-chosen. */
export async function deleteAsset(business: BusinessProfile, assetId: string) {
  const asset = must(
    await db().from("assets").select("*").eq("id", assetId).eq("business_id", business.id).maybeSingle(),
    "load asset",
  ) as Asset | null;
  if (!asset) throw new HttpError(404, "Photo not found.");
  await removeObjects("assets", [
    asset.storage_path,
    asset.vertical_path,
    asset.thumb_path,
    asset.storage_path.replace(/original\.jpg$/, "analysis.jpg"),
  ]);
  must(await db().from("assets").delete().eq("id", assetId), "delete asset");
}

/** Owner correction of tags. */
export async function updateAssetTags(business: BusinessProfile, assetId: string, patch: Partial<Pick<Asset, "area" | "angle" | "subject" | "usable" | "shot_slot">>) {
  const allowed: Record<string, unknown> = {};
  for (const k of ["area", "angle", "subject", "usable", "shot_slot"] as const) if (k in patch) allowed[k] = patch[k];
  return must(
    await db().from("assets").update(allowed).eq("id", assetId).eq("business_id", business.id).select("*").single(),
    "update asset",
  ) as Asset;
}
