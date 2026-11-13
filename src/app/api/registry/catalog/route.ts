import { NextResponse } from "next/server";
import { requireApiStaff } from "@/lib/server/auth";
import { api } from "@/lib/server/http";
import { loadCatalog } from "@/lib/server/providers/catalog";

export const maxDuration = 60;

/** Every video model Pika and Higgsfield list, for the "Add model" search. */
export const GET = api(async () => {
  await requireApiStaff();
  return NextResponse.json(await loadCatalog());
});
