/**
 * On-screen text for the built-in assembler, as an ASS subtitle script that
 * ffmpeg's libass renders onto the 1080x1920 video. Mirrors the Shotstack
 * timeline's layout (timeline.ts): hook in a brand box mid-screen, other
 * scene text at the top, voiceover captions at the bottom, and the end card's
 * call to action and booking link. Every word on screen is placed here.
 */

export interface AssScene {
  order: number;
  role: string;
  duration_s: number;
  treatment: "animate" | "still_motion" | "end_card";
  onScreenText: string;
  voiceoverText: string;
}

export interface AssInput {
  scenes: AssScene[];
  businessName: string;
  bookingText: string;
  brandPrimary: string;
  brandAccent: string;
  captions: boolean;
  fontName: string;
}

export const VIDEO_W = 1080;
export const VIDEO_H = 1920;
/** Vertical centre of the end-card logo, and of the CTA and booking boxes below it. */
export const END_CARD_LAYOUT = { logoY: 620, ctaY: 1040, bookingY: 1340 };

const HEX = /^#[0-9a-fA-F]{6}$/;

/** "#RRGGBB" -> ASS "&HAABBGGRR" (alpha 00 = opaque). */
export function assColor(hex: string, fallback: string, alpha = 0): string {
  const c = HEX.test(hex) ? hex : fallback;
  const [r, g, b] = [c.slice(1, 3), c.slice(3, 5), c.slice(5, 7)];
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${b}${g}${r}`.toUpperCase();
}

/** Seconds -> H:MM:SS.cc */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** Plain text -> safe ASS dialogue text (no override blocks or escapes from user text). */
export function assText(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "/")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildAss(input: AssInput): string {
  const scenes = [...input.scenes].sort((a, b) => a.order - b.order);
  const primary = assColor(input.brandPrimary, "#111111");
  const accent = assColor(input.brandAccent, "#F5C518");
  const white = "&H00FFFFFF";
  const ink = "&H00111111";
  const font = input.fontName;

  // Style fields: Name, Fontname, Fontsize, Primary, Secondary, Outline, Back, Bold, Italic, Underline,
  // StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding.
  // BorderStyle 3 draws an opaque box in the outline colour behind the text.
  const style = (name: string, size: number, color: string, outlineColor: string, borderStyle: 1 | 3, outline: number, align: number, marginV: number) =>
    `Style: ${name},${font},${size},${color},${color},${outlineColor},&H00000000,-1,0,0,0,100,100,0,0,${borderStyle},${outline},0,${align},90,90,${marginV},1`;

  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${VIDEO_W}`,
    `PlayResY: ${VIDEO_H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Hook", 78, white, primary, 3, 22, 5, 0),
    style("Overlay", 62, white, "&H30000000", 1, 5, 8, 230),
    style("Caption", 42, white, "&H38000000", 3, 16, 2, 300),
    style("Cta", 66, white, primary, 3, 24, 5, 0),
    style("Booking", 44, ink, accent, 3, 18, 5, 0),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const event = (layer: number, start: number, end: number, styleName: string, text: string, tags = "") =>
    `Dialogue: ${layer},${assTime(start)},${assTime(end)},${styleName},,0,0,0,,${tags ? `{${tags}}` : ""}${text}`;

  let t = 0;
  for (const s of scenes) {
    const start = t;
    const end = t + Number(s.duration_s);
    t = end;
    if (s.treatment === "end_card") {
      const cta = assText(s.onScreenText || input.businessName);
      if (cta) lines.push(event(2, start, end, "Cta", cta, `\\an5\\pos(${VIDEO_W / 2},${END_CARD_LAYOUT.ctaY})\\fad(350,0)`));
      const booking = assText(input.bookingText);
      if (booking) lines.push(event(2, start, end, "Booking", booking, `\\an5\\pos(${VIDEO_W / 2},${END_CARD_LAYOUT.bookingY})\\fad(350,0)`));
      continue;
    }
    const text = assText(s.onScreenText);
    if (text) {
      const hook = s.role === "hook";
      lines.push(event(1, start, end, hook ? "Hook" : "Overlay", text, hook ? `\\an5\\pos(${VIDEO_W / 2},${Math.round(VIDEO_H * 0.38)})\\fad(350,0)` : "\\fad(350,0)"));
    }
    const caption = assText(s.voiceoverText);
    if (input.captions && caption) lines.push(event(0, start, end, "Caption", caption));
  }
  return lines.join("\n") + "\n";
}
