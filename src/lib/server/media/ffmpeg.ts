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

// ---------------- Built-in assembly (used when SHOTSTACK_API_KEY is not set) ----------------

export interface LocalScene {
  kind: "video" | "image";
  data: Buffer;
  seconds: number;
  /** Darken the still for the end card. */
  endCard: boolean;
}

export interface LocalAssembly {
  scenes: LocalScene[];
  /** ASS script with every on-screen word (core/ass.ts). */
  ass: string;
  fontsDir: string;
  logo: Buffer | null;
  /** Corner logo window in seconds, and the end card window for the large logo. */
  cornerLogo: { start: number; end: number } | null;
  endCardLogo: { start: number; end: number; centerY: number } | null;
  voice: { data: Buffer; start: number }[];
  music: Buffer | null;
}

const FPS = 30;
const SEGMENT = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), "-an"];

/**
 * Builds the final 1080x1920 MP4 with ffmpeg alone: each scene becomes a
 * same-format segment (clips cropped to 9:16 and held on the last frame if
 * short; stills get a slow push-in), the segments are joined, then text
 * (libass), logos, voiceover and music are added in one pass.
 */
export async function localAssemble(input: LocalAssembly): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const parts: string[] = [];
    for (const [i, s] of input.scenes.entries()) {
      const part = path.join(dir, `part_${i}.mp4`);
      const seconds = Math.max(0.5, s.seconds);
      if (s.kind === "video") {
        const src = path.join(dir, `src_${i}.mp4`);
        await writeFile(src, s.data);
        await ffmpeg([
          "-i", src,
          "-vf", `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=${FPS},tpad=stop_mode=clone:stop_duration=${seconds.toFixed(2)},setsar=1`,
          "-t", seconds.toFixed(2), ...SEGMENT, "-y", part,
        ], 240_000);
      } else {
        const src = path.join(dir, `src_${i}.jpg`);
        await writeFile(src, s.data);
        const frames = Math.round(seconds * FPS);
        const grade = s.endCard ? ",eq=brightness=-0.22:saturation=0.85" : "";
        await ffmpeg([
          "-i", src,
          "-vf",
          `scale=1296:2304:force_original_aspect_ratio=increase,crop=1296:2304,zoompan=z='min(1+0.0009*on,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${FPS}${grade},setsar=1`,
          "-frames:v", String(frames), ...SEGMENT, "-y", part,
        ], 240_000);
      }
      parts.push(part);
    }

    const list = path.join(dir, "list.txt");
    await writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
    const base = path.join(dir, "base.mp4");
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-y", base], 120_000);
    const total = input.scenes.reduce((sum, s) => sum + Math.max(0.5, s.seconds), 0);

    const assFile = path.join(dir, "text.ass");
    await writeFile(assFile, input.ass);

    const args: string[] = ["-i", base];
    let next = 1;
    const filters: string[] = [];
    let video = "[0:v]";

    if (input.logo && (input.cornerLogo || input.endCardLogo)) {
      const logo = path.join(dir, "logo.png");
      await writeFile(logo, input.logo);
      args.push("-loop", "1", "-t", total.toFixed(2), "-i", logo);
      const li = next++;
      filters.push(`[${li}:v]format=rgba,split=2[logoA][logoB]`);
      if (input.endCardLogo) {
        const e = input.endCardLogo;
        filters.push(`[logoA]scale=410:-1[logoBig]`);
        filters.push(`${video}[logoBig]overlay=x=(W-w)/2:y=${e.centerY}-h/2:enable='between(t,${e.start.toFixed(2)},${e.end.toFixed(2)})'[vlogo1]`);
        video = "[vlogo1]";
      } else filters.push(`[logoA]nullsink`);
      if (input.cornerLogo) {
        const c = input.cornerLogo;
        filters.push(`[logoB]scale=170:-1,colorchannelmixer=aa=0.92[logoSmall]`);
        filters.push(`${video}[logoSmall]overlay=x=W-w-44:y=60:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[vlogo2]`);
        video = "[vlogo2]";
      } else filters.push(`[logoB]nullsink`);
    }
    filters.push(`${video}subtitles=filename='${assFile}':fontsdir='${input.fontsDir}'[vout]`);

    const audio: string[] = [];
    for (const [i, v] of input.voice.entries()) {
      const f = path.join(dir, `vo_${i}.mp3`);
      await writeFile(f, v.data);
      args.push("-i", f);
      const ms = Math.round(v.start * 1000);
      filters.push(`[${next++}:a]aresample=44100,adelay=${ms}|${ms},apad[vo${i}]`);
      audio.push(`[vo${i}]`);
    }
    if (input.music) {
      const f = path.join(dir, "music.mp3");
      await writeFile(f, input.music);
      args.push("-stream_loop", "-1", "-i", f);
      const fadeOut = Math.max(0, total - 1.5).toFixed(2);
      filters.push(`[${next++}:a]aresample=44100,atrim=0:${total.toFixed(2)},volume=${input.voice.length ? 0.12 : 0.35},afade=t=in:d=1,afade=t=out:st=${fadeOut}:d=1.5[music]`);
      audio.push("[music]");
    }
    if (!audio.length) {
      args.push("-f", "lavfi", "-t", total.toFixed(2), "-i", "anullsrc=r=44100:cl=stereo");
      filters.push(`[${next++}:a]anull[aout]`);
    } else {
      filters.push(`${audio.join("")}amix=inputs=${audio.length}:normalize=0:duration=longest,atrim=0:${total.toFixed(2)}[aout]`);
    }

    const out = path.join(dir, "final.mp4");
    await ffmpeg([
      ...args,
      "-filter_complex", filters.join(";"),
      "-map", "[vout]", "-map", "[aout]",
      "-t", total.toFixed(2),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-y", out,
    ], 280_000);
    return readFile(out);
  });
}
