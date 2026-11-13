-- Quality first: cost is no longer a constraint.
--
-- 1. Seed models that support it render at 1080p (the final video is
--    1080x1920) instead of 720p/768p. Only rows still as seeded are touched.
-- 2. Flagship models join the registry so the router can pick them. Settings
--    come from each provider's published input schema and price (November
--    2026). Tags are starting guesses until the UI/UX team evaluates them.
--    Existing rows with the same id (e.g. added from the catalog) are kept.
-- 3. Credit caps rise so higher-quality renders and retries are not blocked.

update model_registry
set resolution = '1080p',
    request_config = request_config || jsonb_build_object('static', coalesce(request_config -> 'static', '{}'::jsonb) || '{"resolution": "1080p"}'::jsonb),
    cost_credits_per_second = case model_id
      when 'pika:pika/pika-h3-flex/image-to-video' then 3.5
      when 'pika:pika/pika-2.5/image-to-video' then 6
      when 'pika:kling/kling-3.0/image-to-video' then 9
      else cost_credits_per_second end
where evaluator = 'seed: provider docs'
  and model_id in (
    'pika:pika/pika-h3-flex/image-to-video',
    'pika:pika/pika-2.5/image-to-video',
    'pika:kling/kling-3.0/image-to-video',
    'higgsfield:bytedance/seedance-2.5/image-to-video',
    'higgsfield:wan/v2.7/image-to-video'
  );

insert into model_registry (
  model_id, provider, endpoint, display_name, status, status_reason, enabled,
  pros, cons, best_for, avoid_for, start_image_support,
  min_duration_s, max_duration_s, allowed_durations, aspect_ratios, resolution,
  cost_credits_per_second, latency_s, prompt_guidelines, request_config,
  evidence_links, evaluated_on, evaluator
) values
(
  'pika:kling/kling-4.0/image-to-video', 'pika', 'kling/kling-4.0/image-to-video', 'Kling 4.0 (via Pika API)',
  'usable_with_caveats', 'Flagship model added for quality-first routing; pending UI/UX evaluation.', true,
  'Newest Kling generation at 1080p: the most realistic hands, hair and people motion in the registry; 3-30 s.',
  'Slowest and most expensive option; not yet evaluated on salon footage.',
  array['hands_with_tools', 'hair_close_up', 'back_of_person', 'face_visible', 'camera_push'],
  array[]::text[],
  true, 3, 30, null, array['follows_input'], '1080p',
  23.5, 240,
  'Describe one clear action and one camera move in plain words. Say "the scene stays exactly as in the photo". Avoid asking for text, logos or new people.',
  '{"image_field":"image_url","prompt_field":"prompt","duration_field":"duration","static":{"resolution":"1080p","watermark":false}}',
  array['https://dev.pika.art/models/kling/kling-4.0/image-to-video'], null, 'seed: quality-first'
),
(
  'higgsfield:kling-video/v3.0/pro/image-to-video', 'higgsfield', 'kling-video/v3.0/pro/image-to-video', 'Kling 3.0 Pro (Higgsfield)',
  'usable_with_caveats', 'Flagship model added for quality-first routing; pending UI/UX evaluation.', true,
  'Kling 3.0 Pro tier: strong realism for hands, tools and people; 3-15 s.',
  'Higgsfield does not publish prices (cost is an estimate); not yet evaluated on salon footage.',
  array['hands_with_tools', 'hair_close_up', 'back_of_person', 'face_visible'],
  array[]::text[],
  true, 3, 15, null, array['follows_input'], '1080p',
  12, 180,
  'Describe one clear action and one camera move in plain words. Say "the scene stays exactly as in the photo". Avoid asking for text, logos or new people.',
  '{"image_field":"image_url","prompt_field":"prompt","duration_field":"duration","static":{"multi_shots":false,"sound":"off"}}',
  array['https://docs.higgsfield.ai/docs/models/kling-3/pro-image-to-video'], null, 'seed: quality-first'
),
(
  'pika:bytedance/seedance-2.5/image-to-video', 'pika', 'bytedance/seedance-2.5/image-to-video', 'Seedance 2.5 1080p (via Pika API)',
  'usable_with_caveats', 'Flagship model added for quality-first routing; pending UI/UX evaluation.', true,
  'Seedance 2.5 at 1080p with native 9:16: smooth camera moves and natural ambient motion; 4-30 s.',
  'Priced per token by Pika (cost is an estimate); not yet evaluated on salon footage.',
  array['camera_push', 'environment_motion', 'wide_interior', 'hands_with_tools', 'hair_close_up'],
  array[]::text[],
  true, 4, 30, null, array['9:16'], '1080p',
  10, 180,
  'Describe one smooth camera move and one subtle motion. Say "the scene stays exactly as in the photo". Avoid asking for text, logos or new people.',
  '{"image_field":"image_url","prompt_field":"prompt","duration_field":"duration","static":{"ratio":"9:16","resolution":"1080p","generate_audio":false,"watermark":false}}',
  array['https://dev.pika.art/models/bytedance/seedance-2.5/image-to-video'], null, 'seed: quality-first'
),
(
  'pika:alibaba/wan3.0-video-prime/image-to-video', 'pika', 'alibaba/wan3.0-video-prime/image-to-video', 'Wan 3.0 Prime (via Pika API)',
  'usable_with_caveats', 'Flagship model added for quality-first routing; pending UI/UX evaluation.', true,
  'Wan 3.0 Prime tier at 1080p, native 9:16: rich environment and light motion that stays faithful to the photo; 2-30 s.',
  'Not yet evaluated on salon footage.',
  array['environment_motion', 'subtle_light_change', 'wide_interior', 'product_detail', 'storefront_exterior'],
  array[]::text[],
  true, 2, 30, null, array['9:16'], '1080p',
  21, 180,
  'Describe one gentle camera move and one ambient motion such as light or reflections. Say "the scene stays exactly as in the photo". Avoid asking for text, logos or new people.',
  '{"image_field":"first_frame_url","prompt_field":"prompt","duration_field":"duration","static":{"ratio":"9:16","resolution":"1080p","audio":false,"watermark":false}}',
  array['https://dev.pika.art/models/alibaba/wan3.0-video-prime/image-to-video'], null, 'seed: quality-first'
),
(
  'pika:minimax/hailuo-2.3/image-to-video', 'pika', 'minimax/hailuo-2.3/image-to-video', 'Hailuo 2.3 1080p (via Pika API)',
  'usable_with_caveats', 'Flagship model added for quality-first routing; pending UI/UX evaluation.', true,
  'Hailuo 2.3 at 1080p (the Higgsfield entry is 768p): expressive people motion.',
  'Only 6 or 10 s clips (trimmed in assembly); not yet evaluated on salon footage.',
  array['face_visible', 'back_of_person', 'hair_close_up'],
  array['product_detail'],
  true, 6, 10, array[6, 10], array['follows_input'], '1080p',
  4.9, 180,
  'Describe one natural movement of the person and a slow camera move. Say "the scene stays exactly as in the photo". Avoid asking for text, logos or new people.',
  '{"image_field":"first_frame_image","prompt_field":"prompt","duration_field":"duration","static":{"resolution":"1080p","prompt_optimizer":false}}',
  array['https://dev.pika.art/models/minimax/hailuo-2.3/image-to-video'], null, 'seed: quality-first'
)
on conflict (model_id) do nothing;

update business_profiles set credit_cap_default = greatest(credit_cap_default, 5000);
update projects set credit_cap = greatest(credit_cap, 5000) where status not in ('complete', 'failed');
