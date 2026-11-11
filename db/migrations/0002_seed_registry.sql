-- Seed entries for the model registry, built from each provider's published API
-- schema and pricing (checked November 2026). These are NOT UI/UX evaluations:
-- every entry is marked "usable with caveats" with no evaluated_on date, so the
-- ops registry page flags all of them for evaluation (FR-17). The best_for /
-- avoid_for tags are starting guesses for the router and should be replaced by
-- the UI/UX team's results (Appendix A).
--
-- Cost unit: 1 credit = $0.01. Pika prices come from the public Pika catalog.
-- Higgsfield does not publish per-model prices in its docs, so those costs are
-- estimates to confirm in the Higgsfield console.

insert into model_registry (
  model_id, provider, endpoint, display_name, status, status_reason, enabled,
  pros, cons, best_for, avoid_for, start_image_support,
  min_duration_s, max_duration_s, allowed_durations, aspect_ratios, resolution,
  cost_credits_per_second, latency_s, prompt_guidelines, request_config,
  evidence_links, evaluated_on, evaluator
) values
(
  'pika:pika/pika-h3-flex/image-to-video', 'pika', 'pika/pika-h3-flex/image-to-video', 'Pika H3 Flex',
  'usable_with_caveats', 'Seed entry from provider docs; pending UI/UX evaluation.', true,
  'Cheap at 768p; accepts first frame and native 9:16; flexible 3-15 s durations.',
  'Generates its own audio (muted in assembly); hand and face realism not yet evaluated.',
  array['camera_push', 'wide_interior', 'environment_motion', 'storefront_exterior'],
  array['face_visible'],
  true, 3, 15, null, array['9:16'], '768p',
  2, 90,
  'Describe one simple camera move and one subtle motion. Say "the scene stays exactly as in the photo". Avoid asking for text or new objects.',
  '{"image_field":"image","prompt_field":"prompt","duration_field":"duration","static":{"aspect_ratio":"9:16","resolution":"768p","rewrite":false}}',
  array['https://dev.pika.art/models/pika/pika-h3-flex/image-to-video'], null, 'seed: provider docs'
),
(
  'pika:pika/pika-2.5/image-to-video', 'pika', 'pika/pika-2.5/image-to-video', 'Pika 2.5',
  'usable_with_caveats', 'Seed entry from provider docs; pending UI/UX evaluation.', true,
  'Image carries the subject; good for gentle ambient motion and product or sign details.',
  'Only 5 or 10 s clips (trimmed in assembly); 720p tier costs more than H3 Flex.',
  array['subtle_light_change', 'product_detail', 'storefront_exterior'],
  array['hands_with_tools', 'face_visible'],
  true, 5, 10, array[5, 10], array['follows_input'], '720p',
  4, 90,
  'Keep prompts short and motion-focused; the source image carries the subject. Use negative prompt for text, logos, extra people.',
  '{"image_field":"image","prompt_field":"prompt","duration_field":"duration_s","negative_prompt_field":"negative_prompt","static":{"resolution":"720p"}}',
  array['https://dev.pika.art/models/pika/pika-2.5/image-to-video'], null, 'seed: provider docs'
),
(
  'pika:kling/kling-3.0/image-to-video', 'pika', 'kling/kling-3.0/image-to-video', 'Kling 3.0 (via Pika API)',
  'usable_with_caveats', 'Seed entry from provider docs; pending UI/UX evaluation.', true,
  'Strong human motion reputation; first-frame input; 3-15 s durations; audio off by default.',
  'Most expensive seeded option (6.8 credits/s at 720p).',
  array['hands_with_tools', 'hair_close_up', 'back_of_person', 'face_visible'],
  array[]::text[],
  true, 3, 15, null, array['follows_input'], '720p',
  6.8, 150,
  'Describe the action of hands and tools precisely, at a slow pace. One action per clip. Keep camera mostly static.',
  '{"image_field":"image_url","prompt_field":"prompt","duration_field":"duration","static":{"resolution":"720p","audio":"off"}}',
  array['https://dev.pika.art/models/kling/kling-3.0/image-to-video'], null, 'seed: provider docs'
),
(
  'higgsfield:bytedance/seedance-2.5/image-to-video', 'higgsfield', 'bytedance/seedance-2.5/image-to-video', 'Seedance 2.5 (Higgsfield)',
  'usable_with_caveats', 'Seed entry from provider docs; pending UI/UX evaluation. Cost is an estimate; confirm in the Higgsfield console.', true,
  'Output framing follows the input image; 4-30 s; optional end frame.',
  'Minimum 4 s; audio generation must be turned off.',
  array['camera_push', 'environment_motion', 'hands_with_tools', 'hair_close_up'],
  array[]::text[],
  true, 4, 30, null, array['follows_input'], '720p',
  5, 120,
  'Lead with the camera move, then the subject motion. State that the background, mirrors and signage do not change.',
  '{"image_field":"image_url","prompt_field":"prompt","duration_field":"duration","static":{"resolution":"720p","generate_audio":false}}',
  array['https://docs.higgsfield.ai/docs/models/seedance-2-5/image-to-video.md'], null, 'seed: provider docs'
),
(
  'higgsfield:wan/v2.7/image-to-video', 'higgsfield', 'wan/v2.7/image-to-video', 'Wan 2.7 (Higgsfield)',
  'usable_with_caveats', 'Seed entry from provider docs; pending UI/UX evaluation. Cost is an estimate; confirm in the Higgsfield console.', true,
  'Short clips from 2 s; negative prompt support; prompt optional.',
  'Human detail not yet evaluated.',
  array['environment_motion', 'subtle_light_change', 'product_detail', 'wide_interior'],
  array['face_visible'],
  true, 2, 15, null, array['follows_input'], '720p',
  4, 120,
  'Short, concrete motion phrases. Put "text, logo, extra people, warped hands" in the negative prompt.',
  '{"image_field":"image_url","prompt_field":"prompt","duration_field":"duration","negative_prompt_field":"negative_prompt","static":{"resolution":"720p","prompt_extend":false}}',
  array['https://docs.higgsfield.ai/docs/models/wan-2-7/image-to-video.md'], null, 'seed: provider docs'
),
(
  'higgsfield:kling-video/v2.5-turbo/pro/image-to-video', 'higgsfield', 'kling-video/v2.5-turbo/pro/image-to-video', 'Kling 2.5 Turbo Pro (Higgsfield)',
  'usable_with_caveats', 'Seed entry from provider docs; pending UI/UX evaluation. Cost is an estimate; confirm in the Higgsfield console.', true,
  'Fast turbo tier; negative prompt support.',
  'Only 5 or 10 s clips (trimmed in assembly).',
  array['back_of_person', 'hands_with_tools'],
  array['wide_interior'],
  true, 5, 10, array[5, 10], array['follows_input'], '720p',
  7, 100,
  'One clear action, slow and steady. Use the negative prompt for text, logos, distortion.',
  '{"image_field":"image_url","prompt_field":"prompt","duration_field":"duration","negative_prompt_field":"negative_prompt","static":{}}',
  array['https://docs.higgsfield.ai/docs/openapi.json'], null, 'seed: provider docs'
),
(
  'higgsfield:minimax/hailuo-2.3/standard/image-to-video', 'higgsfield', 'minimax/hailuo-2.3/standard/image-to-video', 'Hailuo 2.3 Standard (Higgsfield)',
  'usable_with_caveats', 'Seed entry from provider docs; pending UI/UX evaluation. Cost is an estimate; confirm in the Higgsfield console.', true,
  'Built-in prompt optimizer; known for expressive people motion.',
  'Minimum 6 s clip, so short scenes pay for unused seconds.',
  array['face_visible', 'back_of_person'],
  array['product_detail'],
  true, 6, 10, array[6, 10], array['follows_input'], '768p',
  5, 150,
  'Describe the person''s gentle motion and expression simply. Keep camera static.',
  '{"image_field":"image_url","prompt_field":"prompt","duration_field":"duration","static":{"prompt_optimizer":false}}',
  array['https://docs.higgsfield.ai/docs/openapi.json'], null, 'seed: provider docs'
)
on conflict (model_id) do nothing;
