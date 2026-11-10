import "server-only";
import sharp, { type Sharp } from "sharp";
import { MIN_SHORT_SIDE_PX } from "../../core/vocabulary";

export interface ProcessedPhoto {
  width: number;
  height: number;
  orientation: "portrait" | "landscape" | "square";
  original: Buffer; // EXIF-rotated JPEG
  vertical: Buffer; // 1080x1920 crop, the start image for video models
  thumb: Buffer; // 360x640 preview
  analysis: Buffer; // <=1568px long side, for Claude vision
  qualityFlags: string[];
}

/** Normalizes an upload and derives the 9:16 start image (FR-1, FR-2 deterministic checks). */
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  let base: Sharp;
  try {
    base = sharp(input, { failOn: "error" }).rotate();
  } catch {
    throw new Error("This file is not a supported image.");
  }
  const meta = await base.metadata().catch(() => null);
  if (!meta?.width || !meta?.height) throw new Error("This file is not a supported image (use JPEG, PNG, WebP or AVIF).");

  const original = await base.clone().jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  const info = await sharp(original).metadata();
  const width = info.width ?? meta.width;
  const height = info.height ?? meta.height;
  const ratio = width / height;
  const orientation = ratio > 1.05 ? "landscape" : ratio < 0.95 ? "portrait" : "square";

  const qualityFlags: string[] = [];
  if (Math.min(width, height) < MIN_SHORT_SIDE_PX) qualityFlags.push("low_resolution");
  // A landscape photo loses most of its width when cropped to 9:16.
  if (ratio > 1.2) qualityFlags.push("bad_orientation");

  const vertical = await sharp(original)
    .resize(1080, 1920, { fit: "cover", position: sharp.strategy.attention })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  const thumb = await sharp(vertical).resize(360, 640).jpeg({ quality: 78 }).toBuffer();
  const analysis = await sharp(original)
    .resize(1568, 1568, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  return { width, height, orientation, original, vertical, thumb, analysis, qualityFlags };
}

/** Small grayscale raster for pixel similarity (FR-26). */
export async function grayRaster(input: Buffer, w = 36, h = 64): Promise<Uint8Array> {
  const { data } = await sharp(input)
    .resize(w, h, { fit: "cover", position: "centre" })
    .greyscale()
    .blur(0.6)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

export async function toJpegBase64(input: Buffer, maxSide = 1024): Promise<string> {
  const out = await sharp(input).resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return out.toString("base64");
}

export async function normalizeLogo(input: Buffer): Promise<Buffer> {
  return sharp(input).rotate().resize(1000, 1000, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
}
