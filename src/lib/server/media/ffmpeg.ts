import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const run = promisify(execFile);

function ffmpegPath(): string | null {
  const candidates = [
    process.env.FFMPEG_PATH,
    typeof ffmpegStatic === "string" ? ffmpegStatic : null,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
    "/usr/bin/ffmpeg",
  ];
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
}

export function ffmpegAvailable(): boolean {
  return ffmpegPath() !== null;
}

async function ffmpeg(args: string[], timeoutMs = 120_000): Promise<{ stdout: string; stderr: string }> {
  const bin = ffmpegPath();
  if (!bin) throw new Error("ffmpeg is not available in this environment.");
  try {
    const { stdout, stderr } = await run(bin, ["-hide_banner", "-nostdin", ...args], {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  } catch (err) {
    // `ffmpeg -i file` with no output exits 1 but still prints stream info.
    const e = err as { stdout?: string; stderr?: string; code?: number };
    if (e.stderr && args.length === 2 && args[0] === "-i") return { stdout: String(e.stdout ?? ""), stderr: String(e.stderr) };
    throw new Error(`ffmpeg failed: ${String(e.stderr ?? err).slice(-600)}`);
  }
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "rample-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface Probe {
  duration_s: number;
  width: number;
  height: number;
  has_audio: boolean;
}

export async function probeFile(file: string): Promise<Probe> {
  const { stderr } = await ffmpeg(["-i", file]);
  const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const v = stderr.match(/Stream #[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  if (!d || !v) throw new Error("Could not read media metadata.");
  // Honor rotation metadata from phones.
  const rotated = /rotate\s*:\s*(90|270|-90)/.test(stderr) || /rotation of -?90/.test(stderr);
  const w = Number(v[1]);
  const h = Number(v[2]);
  return {
    duration_s: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]),
    width: rotated ? h : w,
    height: rotated ? w : h,
    has_audio: /Stream #[^\n]*Audio:/.test(stderr),
  };
}

export async function extractFrames(file: string, times: number[], dir: string): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (let i = 0; i < times.length; i++) {
    const target = path.join(dir, `frame_${i}.jpg`);
    await ffmpeg(["-ss", Math.max(0, times[i]).toFixed(2), "-i", file, "-frames:v", "1", "-q:v", "3", "-y", target]);
    out.push(await readFile(target));
  }
  return out;
}

export async function volumeStats(file: string): Promise<{ mean: number | null; max: number | null }> {
  const { stderr } = await ffmpeg(["-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"]);
  const mean = stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
  const max = stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
  return { mean: mean ? Number(mean[1]) : null, max: max ? Number(max[1]) : null };
}

export async function audioDuration(buffer: Buffer): Promise<number | null> {
  return withTempDir(async (dir) => {
    const f = path.join(dir, "a.mp3");
    await writeFile(f, buffer);
    const { stderr } = await ffmpeg(["-i", f]);
    const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    return d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null;
  });
}

// ---------------- Mock media (MEDIA_MODE=mock): no credits spent ----------------

/** Stand-in for an image-to-video model: a slow push on the photo. */
export async function mockClipFromImage(image: Buffer, seconds: number): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const img = path.join(dir, "in.jpg");
    const out = path.join(dir, "out.mp4");
    await writeFile(img, image);
    const frames = Math.round(seconds * 25);
    await ffmpeg([
      "-loop", "1", "-i", img,
      "-vf", `scale=1440:2560,zoompan=z='min(zoom+0.0012,1.12)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x1280:fps=25`,
      "-t", seconds.toFixed(2), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-y", out,
    ], 180_000);
    return readFile(out);
  });
}

/** Stand-in for text-to-speech: a quiet tone sized to the spoken line. */
export async function mockVoiceover(text: string): Promise<Buffer> {
  const seconds = Math.max(0.8, Math.min(8, text.split(/\s+/).length / 2.6));
  return withTempDir(async (dir) => {
    const out = path.join(dir, "vo.mp3");
    await ffmpeg(["-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds.toFixed(2)}`, "-af", "volume=0.25", "-c:a", "libmp3lame", "-q:a", "5", "-y", out]);
    return readFile(out);
  });
}

/** Stand-in for Shotstack: concatenates scene visuals at 1080x1920 with a tone track. No text overlays. */
export async function mockAssemble(
  scenes: { kind: "video" | "image"; data: Buffer; seconds: number }[],
): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const parts: string[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const src = path.join(dir, `src_${i}.${s.kind === "video" ? "mp4" : "jpg"}`);
      const part = path.join(dir, `part_${i}.mp4`);
      await writeFile(src, s.data);
      const input = s.kind === "video" ? ["-i", src] : ["-loop", "1", "-i", src];
      await ffmpeg([
        ...input,
        "-t", s.seconds.toFixed(2),
        "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-y", part,
      ], 180_000);
      parts.push(part);
    }
    const list = path.join(dir, "list.txt");
    await writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
    const total = scenes.reduce((s, x) => s + x.seconds, 0);
    const out = path.join(dir, "final.mp4");
    await ffmpeg([
      "-f", "concat", "-safe", "0", "-i", list,
      "-f", "lavfi", "-i", `sine=frequency=220:duration=${total.toFixed(2)}`,
      "-filter:a", "volume=0.3",
      "-c:v", "copy", "-c:a", "aac", "-shortest", "-y", out,
    ], 180_000);
    return readFile(out);
  });
}
