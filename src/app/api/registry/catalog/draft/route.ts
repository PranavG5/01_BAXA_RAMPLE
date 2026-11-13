import { NextResponse } from "next/server";
import { requireApiStaff } from "@/lib/server/auth";
import { api, badRequest, notFound } from "@/lib/server/http";
import { draftFor } from "@/lib/server/providers/catalog";

export const maxDuration = 60;

/** A registry entry pre-filled from the chosen model's input schema and pricing. */
export const GET = api(async (req: Request) => {
  await requireApiStaff();
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  const endpoint = url.searchParams.get("endpoint") ?? "";
  if (provider !== "pika" && provider !== "higgsfield") throw badRequest("provider must be pika or higgsfield.");
  const draft = await draftFor(provider, endpoint);
  if (!draft) throw notFound("That model is not in the provider's catalog.");
  return NextResponse.json(draft);
});
