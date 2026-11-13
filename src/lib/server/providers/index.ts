import "server-only";
import { env } from "../env";
import { higgsfield } from "./higgsfield";
import { mock } from "./mock";
import { pika } from "./pika";
import type { ProviderAdapter } from "./types";

export function adapterFor(provider: string): ProviderAdapter {
  if (env.mediaMode() === "mock" || provider === "mock") return mock;
  if (provider === "higgsfield") return higgsfield;
  if (provider === "pika") return pika;
  throw new Error(`Unknown provider ${provider}`);
}

export function providerStatus() {
  return {
    mode: env.mediaMode(),
    higgsfield: higgsfield.configured(),
    higgsfieldProblem: env.higgsfieldKey().problem,
    pika: pika.configured(),
  };
}
