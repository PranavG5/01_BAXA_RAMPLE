import { stat, open } from "node:fs/promises";
import { getBlobResponse, localPath, usesBlob, verifyFileLink, type Bucket } from "@/lib/server/storage";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
};

/** Serves stored files behind short-lived signed links (with Range support for video). */
export async function GET(req: Request, { params }: { params: Promise<{ bucket: string; path: string[] }> }) {
  const { bucket, path } = await params;
  if (bucket !== "assets" && bucket !== "media") return new Response("Not found", { status: 404 });
  const key = path.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  const download = url.searchParams.get("d") ?? "";
  if (!verifyFileLink(bucket, key, Number(url.searchParams.get("e")), download, url.searchParams.get("s") ?? "")) {
    return new Response("Link expired or invalid", { status: 403 });
  }
  const headers: Record<string, string> = {
    "Content-Type": TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download.replace(/[^\w.-]/g, "_")}"`;

  if (usesBlob()) {
    let blob;
    try {
      blob = await getBlobResponse(bucket as Bucket, key, req.headers.get("range"));
    } catch (err) {
      console.error("[files] blob read failed", bucket, key, err);
      return new Response("Could not read file", { status: 502 });
    }
    if (!blob) return new Response("Not found", { status: 404 });
    const contentRange = blob.headers.get("content-range");
    const length = blob.headers.get("content-length");
    if (length) headers["Content-Length"] = length;
    if (contentRange) headers["Content-Range"] = contentRange;
    return new Response(blob.stream, { status: contentRange ? 206 : 200, headers });
  }

  let file: string;
  let size: number;
  try {
    file = localPath(bucket as Bucket, key);
    size = (await stat(file)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  let start = 0;
  let end = size - 1;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const fh = await open(file, "r");
  const length = end - start + 1;
  const buf = Buffer.alloc(length);
  await fh.read(buf, 0, length, start);
  await fh.close();
  headers["Content-Length"] = String(length);
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  return new Response(new Uint8Array(buf), { status: range ? 206 : 200, headers });
}
