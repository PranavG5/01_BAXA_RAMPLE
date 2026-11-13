import { test } from "node:test";
import assert from "node:assert/strict";
import { draftFromSchema, higgsfieldEntries, parseHiggsfieldDocs, parsePikaCatalog, pikaCreditsPerSecond } from "../src/lib/core/catalog.ts";

const pikaPricing = {
  components: [
    {
      role: "output",
      unit: { type: "second", quantity: 1 },
      starting_at: { spec: { resolution: "480p" }, micro_usd: 10000 },
      price_tiers: [
        { spec: { resolution: "480p" }, micro_usd: 10000 },
        { spec: { resolution: "768p" }, micro_usd: 20000 },
        { spec: { resolution: "1080p" }, micro_usd: 35000 },
      ],
    },
  ],
};

test("Pika price converts micro-USD per second to credits at the chosen resolution", () => {
  assert.equal(pikaCreditsPerSecond(pikaPricing, "768p"), 2);
  assert.equal(pikaCreditsPerSecond(pikaPricing, null), 1);
  assert.equal(pikaCreditsPerSecond({ components: [{ role: "output", unit: { type: "minute", quantity: 1 }, starting_at: { micro_usd: 600000 } }] }, null), 1);
  assert.equal(pikaCreditsPerSecond({ components: [{ role: "output", unit: { type: "output_token", quantity: 1e6 }, starting_at: { micro_usd: 5 } }] }, null), null);
});

test("Pika catalog keeps video operations and marks start-image support", () => {
  const entries = parsePikaCatalog({
    apis: [
      { api_id: "pika/pika-h3-flex/image-to-video", category: "video", function: "image-to-video", name: "Pika H3 Flex", display_pricing: pikaPricing },
      { api_id: "x/y/text-to-video", category: "video", function: "text-to-video", name: "Y" },
      { api_id: "x/img/text-to-image", category: "image", function: "text-to-image", name: "Img" },
    ],
  });
  assert.deepEqual(entries.map((e) => [e.endpoint, e.startImage]), [["pika/pika-h3-flex/image-to-video", true], ["x/y/text-to-video", false]]);
});

test("schema maps onto a silent 9:16 request with the start image and duration limits", () => {
  const d = draftFromSchema({
    provider: "pika",
    endpoint: "pika/pika-h3-flex/image-to-video",
    name: "Pika H3 Flex",
    docsUrl: "https://dev.pika.art/models/pika/pika-h3-flex/image-to-video",
    pricing: pikaPricing,
    schema: {
      required: ["image"],
      properties: {
        image: { type: "string" },
        prompt: { anyOf: [{ type: "string" }, { type: "null" }] },
        duration: { type: "integer", minimum: 3, maximum: 15, default: 5 },
        aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"] },
        resolution: { type: "string", enum: ["480p", "768p", "1080p"] },
        rewrite: { type: "boolean" },
        generate_audio: { type: "boolean" },
      },
    },
  });
  assert.deepEqual(d.warnings, []);
  assert.equal(d.model.status, "usable_with_caveats");
  assert.equal(d.model.cost_credits_per_second, 3.5);
  assert.deepEqual([d.model.min_duration_s, d.model.max_duration_s, d.model.allowed_durations], [3, 15, null]);
  assert.deepEqual(d.model.aspect_ratios, ["9:16"]);
  assert.deepEqual(d.model.request_config, {
    image_field: "image",
    prompt_field: "prompt",
    duration_field: "duration",
    static: { aspect_ratio: "9:16", resolution: "1080p", rewrite: false, generate_audio: false },
  });
});

test("string durations, enums, unmet required fields and missing start images are flagged", () => {
  const d = draftFromSchema({
    provider: "higgsfield",
    endpoint: "v/motion/pro",
    name: "Motion · Pro",
    docsUrl: "https://docs.higgsfield.ai/docs/models/motion/pro",
    schema: {
      required: ["image_url", "video_url"],
      properties: { image_url: { type: "string" }, prompt: { type: "string" }, video_url: { type: "string" }, duration: { type: "string", enum: ["5", "10"] } },
    },
  });
  assert.equal(d.model.display_name, "Motion · Pro (Higgsfield)");
  assert.equal(d.model.request_config.duration_as_string, true);
  assert.deepEqual(d.model.allowed_durations, [5, 10]);
  assert.equal(d.model.status, "not_usable");
  assert.ok(d.warnings.some((w) => w.includes("`video_url`")));
  assert.ok(d.warnings.some((w) => w.includes("Higgsfield does not publish prices")));

  const t2v = draftFromSchema({ provider: "pika", endpoint: "a/b/text-to-video", name: "B", docsUrl: "https://x", schema: { properties: { prompt: { type: "string" }, duration: { type: "integer", maximum: 120 } } } });
  assert.equal(t2v.model.start_image_support, false);
  assert.equal(t2v.model.max_duration_s, 60);
});

test("Higgsfield docs pages yield endpoint IDs and their JSON schemas", () => {
  const docs = [
    "# Kling 2.5 Turbo — Pro image to video API",
    "Source: https://docs.higgsfield.ai/docs/models/kling-2-5-turbo/pro-image-to-video",
    "",
    "**Endpoint ID:** `kling-video/v2.5-turbo/pro/image-to-video`",
    "",
    "> [accordion] Complete JSON schema",
    ">",
    '> ```json theme={"theme":{}}',
    "> {",
    '>   "required": ["prompt", "image_url"],',
    '>   "properties": { "prompt": { "type": "string" }, "image_url": { "type": "string" }, "duration": { "type": "integer", "enum": [5, 10] } }',
    "> }",
    "> ```",
    "",
    "# Some image model API",
    "Source: https://docs.higgsfield.ai/docs/models/img/generate",
    "**Endpoint ID:** `vendor/img/v1`",
    "",
  ].join("\n");
  const models = parseHiggsfieldDocs(docs);
  assert.deepEqual(models.map((m) => [m.endpoint, m.name, !!m.schema]), [
    ["kling-video/v2.5-turbo/pro/image-to-video", "Kling 2.5 Turbo · Pro image to video", true],
    ["vendor/img/v1", "Some image model", false],
  ]);
  const entries = higgsfieldEntries(models);
  assert.deepEqual(entries.map((e) => [e.endpoint, e.startImage]), [["kling-video/v2.5-turbo/pro/image-to-video", true]]);
});
