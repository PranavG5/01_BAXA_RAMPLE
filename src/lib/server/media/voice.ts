import "server-only";
import { env } from "../env";
import { audioDuration, mockVoiceover } from "./ffmpeg";

/** Text-to-speech for one scene's voiceover line (ElevenLabs, or a tone in mock mode). */
export async function synthesizeVoiceover(text: string): Promise<{ audio: Buffer; seconds: number | null }> {
  if (env.mediaMode() === "mock") {
    const audio = await mockVoiceover(text);
    return { audio, seconds: await audioDuration(audio).catch(() => null) };
  }
  const key = env.elevenLabsApiKey();
  if (!key) throw new Error("ELEVENLABS_API_KEY is not configured.");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.elevenLabsVoiceId())}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: env.elevenLabsModelId(),
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, speed: 1.05 },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const audio = Buffer.from(await res.arrayBuffer());
  return { audio, seconds: await audioDuration(audio).catch(() => null) };
}
