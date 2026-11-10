// Deterministic Shotstack timeline for the final 9:16 video (FR-23, FR-24).
// Every word, price and logo on screen is placed here, never by a video model.

export interface TimelineScene {
  order: number;
  role: string;
  duration_s: number;
  treatment: "animate" | "still_motion" | "end_card";
  visualUrl: string; // accepted clip for animate scenes, the 9:16 photo otherwise
  stillEffect: string | null;
  onScreenText: string;
  voiceoverText: string;
  voiceoverUrl: string | null;
  voiceoverSeconds: number | null;
}

export interface TimelineInput {
  scenes: TimelineScene[];
  businessName: string;
  bookingText: string;
  brandPrimary: string;
  brandAccent: string;
  logoUrl: string | null;
  musicUrl: string | null;
  captions: boolean;
  fontFamily: string;
  callbackUrl?: string | null;
}

type Json = Record<string, unknown>;

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = (c: string, fallback: string) => (HEX.test(c) ? c : fallback);

function textClip(opts: {
  text: string;
  start: number;
  length: number;
  size: number;
  font: string;
  color: string;
  bg: string | null;
  position: string;
  offsetY: number;
  height: number;
  animate?: boolean;
  weight?: number;
}): Json {
  const asset: Json = {
    type: "rich-text",
    text: opts.text,
    font: { family: opts.font, size: opts.size, weight: opts.weight ?? 800, color: opts.color },
    stroke: { width: opts.bg ? 0 : 3, color: "#000000", opacity: 0.8 },
    align: { horizontal: "center", vertical: "middle" },
    style: { lineHeight: 1.15 },
  };
  if (opts.bg) {
    asset.background = { color: opts.bg, opacity: 0.88, borderRadius: 18, wrap: true, padding: 24 };
  }
  if (opts.animate) asset.animation = { preset: "fadeIn", duration: 0.35 };
  return {
    asset,
    start: round(opts.start),
    length: round(opts.length),
    width: 960,
    height: opts.height,
    position: opts.position,
    offset: { x: 0, y: opts.offsetY },
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function sceneStarts(scenes: { duration_s: number }[]): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const s of scenes) {
    starts.push(round(t));
    t += Number(s.duration_s);
  }
  return starts;
}

export function buildTimeline(input: TimelineInput): Json {
  const scenes = [...input.scenes].sort((a, b) => a.order - b.order);
  const starts = sceneStarts(scenes);
  const total = round(scenes.reduce((s, x) => s + Number(x.duration_s), 0));
  const primary = hex(input.brandPrimary, "#111111");
  const accent = hex(input.brandAccent, "#F5C518");
  const font = input.fontFamily || "Open Sans";

  const visuals: Json[] = [];
  const overlays: Json[] = [];
  const captions: Json[] = [];
  const endCardItems: Json[] = [];
  const voice: Json[] = [];

  scenes.forEach((s, i) => {
    const start = starts[i];
    const length = Number(s.duration_s);
    const transition = i === 0 ? undefined : { in: "fadeFast" };

    if (s.treatment === "animate") {
      visuals.push({
        asset: { type: "video", src: s.visualUrl, volume: 0 },
        start,
        length,
        fit: "crop",
        ...(transition ? { transition } : {}),
      });
    } else {
      visuals.push({
        asset: { type: "image", src: s.visualUrl },
        start,
        length,
        fit: "crop",
        effect: s.stillEffect || "zoomInSlow",
        ...(s.treatment === "end_card" ? { filter: "darken" } : {}),
        ...(transition ? { transition } : {}),
      });
    }

    if (s.treatment === "end_card") {
      if (input.logoUrl) {
        endCardItems.push({
          asset: { type: "image", src: input.logoUrl },
          start,
          length,
          fit: "contain",
          scale: 0.38,
          position: "center",
          offset: { x: 0, y: 0.18 },
          transition: { in: "fade" },
        });
      }
      const cta = s.onScreenText || input.businessName;
      endCardItems.push(
        textClip({ text: cta, start, length, size: 68, font, color: "#FFFFFF", bg: primary, position: "center", offsetY: -0.04, height: 360, animate: true }),
      );
      if (input.bookingText) {
        endCardItems.push(
          textClip({ text: input.bookingText, start, length, size: 44, font, color: "#111111", bg: accent, position: "center", offsetY: -0.2, height: 200, weight: 700 }),
        );
      }
    } else if (s.onScreenText) {
      const isHook = s.role === "hook";
      overlays.push(
        textClip({
          text: s.onScreenText,
          start,
          length,
          size: isHook ? 80 : 62,
          font,
          color: "#FFFFFF",
          bg: isHook ? primary : null,
          position: isHook ? "center" : "top",
          offsetY: isHook ? 0.12 : -0.1,
          height: isHook ? 480 : 360,
          animate: true,
        }),
      );
    }

    if (input.captions && s.voiceoverText && s.treatment !== "end_card") {
      captions.push(
        textClip({ text: s.voiceoverText, start, length, size: 42, font, color: "#FFFFFF", bg: "#000000", position: "bottom", offsetY: 0.12, height: 280, weight: 600 }),
      );
    }

    if (s.voiceoverUrl) {
      const vo = s.voiceoverSeconds ?? length;
      voice.push({ asset: { type: "audio", src: s.voiceoverUrl, volume: 1 }, start, length: round(Math.max(0.5, Math.min(vo, total - start))) });
    }
  });

  // Small corner logo from scene 2 up to the end card (never in the hook).
  const logoTrack: Json[] = [];
  const endIdx = scenes.findIndex((s) => s.treatment === "end_card");
  const logoStart = scenes.length > 1 ? starts[1] : null;
  const logoEnd = endIdx >= 0 ? starts[endIdx] : total;
  if (input.logoUrl && logoStart !== null && logoEnd - logoStart > 0.5) {
    logoTrack.push({
      asset: { type: "image", src: input.logoUrl },
      start: logoStart,
      length: round(logoEnd - logoStart),
      fit: "contain",
      scale: 0.16,
      position: "topRight",
      offset: { x: -0.04, y: -0.03 },
      opacity: 0.92,
    });
  }

  const music: Json[] = input.musicUrl
    ? [{ asset: { type: "audio", src: input.musicUrl, volume: voice.length ? 0.12 : 0.35, effect: "fadeInFadeOut" }, start: 0, length: total }]
    : [];

  // Tracks are layered top to bottom: text above images above video.
  const tracks = [captions, overlays, endCardItems, logoTrack, visuals, voice, music]
    .filter((t) => t.length > 0)
    .map((clips) => ({ clips }));

  const edit: Json = {
    timeline: { background: "#000000", tracks },
    output: { format: "mp4", size: { width: 1080, height: 1920 }, fps: 30 },
  };
  if (input.callbackUrl) edit.callback = input.callbackUrl;
  return edit;
}
