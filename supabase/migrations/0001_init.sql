-- Rample.ai Video Marketing Pipeline (PRD v2) - initial schema.
-- All tables have RLS enabled with no policies: only the server (service role)
-- reads and writes them. The browser never talks to these tables directly.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Business profile (FR-4) and photo library (FR-1..3)
-- ---------------------------------------------------------------------------
create table if not exists business_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default '',
  business_type text not null default 'barbershop' check (business_type in ('barbershop', 'salon')),
  services jsonb not null default '[]'::jsonb,        -- [{name, price, notes}]
  brand_colors jsonb not null default '[]'::jsonb,    -- ["#111111", "#f5c518"]
  logo_path text,
  tone text not null default '',
  address text not null default '',
  booking_link text not null default '',
  audience text not null default '',
  extra_facts text not null default '',               -- hours, specials, anything owner-confirmed
  credit_cap_default integer not null default 300 check (credit_cap_default > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business_profiles(id) on delete cascade,
  storage_path text not null,           -- original upload (bucket: assets)
  vertical_path text,                   -- 1080x1920 crop used as start image (bucket: assets)
  thumb_path text,                      -- small preview (bucket: assets)
  original_filename text,
  mime text,
  width integer,
  height integer,
  orientation text check (orientation in ('portrait', 'landscape', 'square')),
  area text,
  angle text,
  subject text,
  description text,
  shot_slot text,
  tags text[] not null default '{}',
  people_visible boolean not null default false,
  faces_visible boolean not null default false,
  text_visible boolean not null default false,
  quality_flags text[] not null default '{}',
  usable boolean not null default true,
  tag_status text not null default 'pending' check (tag_status in ('pending', 'tagged', 'failed')),
  tag_error text,
  consent_confirmed boolean not null,
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint assets_consent_required check (consent_confirmed)
);
create index if not exists assets_business_idx on assets(business_id);

-- ---------------------------------------------------------------------------
-- Model registry (Section 5)
-- ---------------------------------------------------------------------------
create table if not exists registry_meta (
  id integer primary key default 1 check (id = 1),
  registry_version integer not null default 1,
  reeval_window_days integer not null default 60,
  updated_at timestamptz not null default now()
);
insert into registry_meta (id) values (1) on conflict (id) do nothing;

create table if not exists model_registry (
  model_id text primary key,                       -- e.g. 'pika:pika/pika-2.5/image-to-video'
  provider text not null check (provider in ('higgsfield', 'pika')),
  endpoint text not null,                          -- provider path, e.g. 'pika/pika-2.5/image-to-video'
  display_name text not null,
  status text not null check (status in ('usable', 'usable_with_caveats', 'not_usable')),
  status_reason text not null default '',
  enabled boolean not null default true,           -- ops kill switch (FR-15)
  pros text not null default '',
  cons text not null default '',
  best_for text[] not null default '{}',
  avoid_for text[] not null default '{}',
  start_image_support boolean not null default false,
  min_duration_s numeric not null default 1,
  max_duration_s numeric not null,
  allowed_durations integer[],                     -- null = any integer between min and max
  aspect_ratios text[] not null default '{}',      -- '9:16' or 'follows_input'
  resolution text not null default '720p',
  cost_credits_per_second numeric not null,        -- 1 credit = $0.01
  latency_s integer not null default 120,
  prompt_guidelines text not null default '',
  request_config jsonb not null default '{}'::jsonb,
  evidence_links text[] not null default '{}',
  evaluated_on date,
  evaluator text not null default '',
  registry_version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists model_pins (
  shot_type text primary key,
  model_id text not null references model_registry(model_id) on delete cascade,
  created_by text,
  created_at timestamptz not null default now()
);

-- Every registry or pin change bumps the registry version (5.2 registry_version).
create or replace function bump_registry_version() returns trigger language plpgsql as $$
declare v integer;
begin
  update registry_meta set registry_version = registry_version + 1, updated_at = now()
    where id = 1 returning registry_version into v;
  if tg_table_name = 'model_registry' and tg_op <> 'DELETE' then
    new.registry_version := v;
    new.updated_at := now();
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists model_registry_bump on model_registry;
create trigger model_registry_bump before insert or update or delete on model_registry
  for each row execute function bump_registry_version();
drop trigger if exists model_pins_bump on model_pins;
create trigger model_pins_bump before insert or update or delete on model_pins
  for each row execute function bump_registry_version();

-- ---------------------------------------------------------------------------
-- Projects, versioned storyboards, scenes (Section 6, FR-5..10, FR-18)
-- ---------------------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business_profiles(id) on delete cascade,
  title text not null default '',
  original_prompt text not null,
  brief jsonb,
  brief_warnings text[] not null default '{}',
  clarifying_question text,
  clarifying_answer text,
  status text not null default 'brief' check (status in
    ('brief', 'storyboard', 'approved', 'rendering', 'qa', 'needs_review', 'complete', 'failed')),
  current_version_id uuid,
  credit_cap integer not null default 300 check (credit_cap > 0),
  tick_lock_until timestamptz not null default 'epoch',
  first_prompt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_business_idx on projects(business_id);
create index if not exists projects_status_idx on projects(status);

create table if not exists storyboard_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version integer not null,
  state text not null default 'draft' check (state in
    ('draft', 'revised', 'approved', 'rendering', 'qa', 'complete', 'failed')),
  parent_version_id uuid references storyboard_versions(id) on delete set null,
  source text not null default 'generated' check (source in ('generated', 'chat', 'inline')),
  change_note text not null default '',
  music_mood text not null default '',
  rationale text not null default '',
  total_runtime_s numeric not null default 0,
  est_credits numeric not null default 0,
  validation_warnings text[] not null default '{}',
  approved_by uuid,
  approved_at timestamptz,
  registry_version integer,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

alter table projects drop constraint if exists projects_current_version_fk;
alter table projects add constraint projects_current_version_fk
  foreign key (current_version_id) references storyboard_versions(id) on delete set null;

create table if not exists scenes (
  id uuid primary key default gen_random_uuid(),
  storyboard_version_id uuid not null references storyboard_versions(id) on delete cascade,
  scene_order integer not null,
  role text not null check (role in ('hook', 'showcase', 'proof', 'cta')),
  duration_s numeric not null check (duration_s > 0),
  background_asset_id uuid references assets(id) on delete set null,
  treatment text not null check (treatment in ('animate', 'still_motion', 'end_card')),
  shot_type text not null,
  motion_prompt text not null default '',
  model_prompt text,
  subject_description text,
  still_motion_effect text,
  voiceover text not null default '',
  on_screen_text text not null default '',
  model_id text,
  fallback_model_ids text[] not null default '{}',
  est_credits numeric not null default 0,
  render_key text not null default '',          -- hash of render-relevant fields (FR-14, FR-22)
  route_flag text,                              -- set when the router could not pick confidently
  render_status text not null default 'pending' check (render_status in
    ('pending', 'not_needed', 'rendering', 'qa', 'passed', 'needs_review', 'rejected', 'failed')),
  clip_path text,                               -- accepted clip (bucket: media)
  reused_from_scene_id uuid references scenes(id) on delete set null,
  voiceover_path text,
  voiceover_key text,
  created_at timestamptz not null default now(),
  unique (storyboard_version_id, scene_order)
);
create index if not exists scenes_version_idx on scenes(storyboard_version_id);

create table if not exists router_decisions (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references scenes(id) on delete cascade,
  storyboard_version_id uuid not null references storyboard_versions(id) on delete cascade,
  model_id text,
  reason text not null default '',
  fallback text[] not null default '{}',
  confidence text not null check (confidence in ('high', 'medium', 'low', 'none')),
  registry_version integer not null,
  source text not null check (source in ('claude', 'pin', 'reused', 'ops')),
  flagged boolean not null default false,
  flag_reason text,
  attempts integer not null default 1,
  grade text check (grade in ('agree', 'disagree')),
  graded_by text,
  grade_note text,
  created_at timestamptz not null default now()
);
create index if not exists router_decisions_scene_idx on router_decisions(scene_id);

-- ---------------------------------------------------------------------------
-- Rendering (FR-19..22), QA (FR-25..28), delivery (FR-29)
-- ---------------------------------------------------------------------------
create table if not exists render_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  storyboard_version_id uuid not null references storyboard_versions(id) on delete cascade,
  scene_id uuid not null references scenes(id) on delete cascade,
  provider text not null,
  model_id text not null,
  status text not null default 'queued' check (status in
    ('queued', 'submitting', 'submitted', 'in_progress', 'completed', 'failed', 'canceled', 'blocked')),
  attempt integer not null default 1,
  initiated_by text not null default 'system',
  idempotency_key text not null unique,
  provider_request_id text,
  input jsonb not null default '{}'::jsonb,
  output_url text,
  clip_path text,
  est_credits numeric not null default 0,
  credits_used numeric,
  error text,
  failure_kind text check (failure_kind in ('provider', 'qa', 'gate', 'cap')),
  last_polled_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists render_jobs_scene_idx on render_jobs(scene_id);
create index if not exists render_jobs_project_idx on render_jobs(project_id);
create index if not exists render_jobs_provider_req_idx on render_jobs(provider_request_id);

create table if not exists qa_results (
  id uuid primary key default gen_random_uuid(),
  render_job_id uuid references render_jobs(id) on delete cascade,
  scene_id uuid references scenes(id) on delete cascade,
  final_video_id uuid,
  kind text not null check (kind in ('scene', 'final')),
  automated_scores jsonb not null default '{}'::jsonb,
  flags text[] not null default '{}',
  fidelity_score numeric,
  overall text not null check (overall in ('pass', 'borderline', 'fail', 'error')),
  summary text not null default '',
  frame_paths text[] not null default '{}',
  needs_review boolean not null default false,
  reviewer text,
  decision text check (decision in ('approved', 'rejected', 'rerender')),
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists qa_results_review_idx on qa_results(needs_review) where decision is null;

create table if not exists final_videos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  storyboard_version_id uuid not null references storyboard_versions(id) on delete cascade,
  status text not null default 'assembling' check (status in
    ('assembling', 'qa', 'passed', 'failed', 'needs_review', 'rejected')),
  assembly_render_id text,
  assembly_attempt integer not null default 1,
  file_path text,
  poster_path text,
  duration_s numeric,
  qa jsonb not null default '{}'::jsonb,
  error text,
  assembly_cost_credits numeric not null default 0,
  export_count integer not null default 0,
  last_exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists final_videos_project_idx on final_videos(project_id);

alter table qa_results drop constraint if exists qa_results_final_video_fk;
alter table qa_results add constraint qa_results_final_video_fk
  foreign key (final_video_id) references final_videos(id) on delete cascade;

create table if not exists audit_events (
  id bigint generated always as identity primary key,
  project_id uuid references projects(id) on delete cascade,
  actor text,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_project_idx on audit_events(project_id, created_at);

-- ---------------------------------------------------------------------------
-- Hard gate #1 (FR-19, NFR cost management): a render job can only exist for an
-- approved storyboard version. Enforced in the database, not just the UI.
-- ---------------------------------------------------------------------------
create or replace function enforce_render_gate() returns trigger language plpgsql as $$
declare v storyboard_versions;
begin
  select * into v from storyboard_versions where id = new.storyboard_version_id;
  if v.id is null or v.approved_at is null or v.approved_by is null
     or v.state not in ('approved', 'rendering', 'qa') then
    raise exception 'render gate: storyboard version % is not approved', new.storyboard_version_id
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from scenes s where s.id = new.scene_id and s.storyboard_version_id = v.id) then
    raise exception 'render gate: scene % does not belong to version %', new.scene_id, v.id
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists render_jobs_gate on render_jobs;
create trigger render_jobs_gate before insert on render_jobs
  for each row execute function enforce_render_gate();

-- Approved versions are frozen: scenes of an approved version cannot change their
-- render-relevant content. Edits always create a new version (FR-8).
create or replace function freeze_approved_scenes() returns trigger language plpgsql as $$
declare st text;
begin
  select state into st from storyboard_versions where id = old.storyboard_version_id;
  if st in ('approved', 'rendering', 'qa', 'complete', 'failed') and (
     new.duration_s is distinct from old.duration_s or
     new.background_asset_id is distinct from old.background_asset_id or
     new.treatment is distinct from old.treatment or
     new.motion_prompt is distinct from old.motion_prompt or
     new.model_id is distinct from old.model_id or
     new.voiceover is distinct from old.voiceover or
     new.on_screen_text is distinct from old.on_screen_text) then
    raise exception 'scene % belongs to an approved storyboard version and cannot be edited', old.id
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists scenes_freeze on scenes;
create trigger scenes_freeze before update on scenes
  for each row execute function freeze_approved_scenes();

-- ---------------------------------------------------------------------------
-- Hard gate #2 (FR-21): claim a queued job for submission. Atomically re-checks
-- the approval gate and the per-project credit cap, then marks it 'submitting'.
-- Returns jsonb {ok, reason}.
-- ---------------------------------------------------------------------------
create or replace function claim_render_job(p_job_id uuid) returns jsonb language plpgsql as $$
declare
  j render_jobs;
  p projects;
  v storyboard_versions;
  committed numeric;
begin
  select * into j from render_jobs where id = p_job_id for update;
  if j.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if j.status <> 'queued' then return jsonb_build_object('ok', false, 'reason', 'not_queued'); end if;

  select * into p from projects where id = j.project_id for update;
  select * into v from storyboard_versions where id = j.storyboard_version_id;

  if v.approved_at is null or v.approved_by is null or v.state not in ('approved', 'rendering', 'qa') then
    update render_jobs set status = 'blocked', failure_kind = 'gate',
      error = 'storyboard version is not approved', updated_at = now() where id = j.id;
    return jsonb_build_object('ok', false, 'reason', 'not_approved');
  end if;

  select coalesce(sum(coalesce(credits_used, est_credits)), 0) into committed
    from render_jobs
    where project_id = j.project_id
      and id <> j.id
      and (status in ('submitting', 'submitted', 'in_progress', 'completed')
           or (status = 'failed' and coalesce(credits_used, 0) > 0));

  if committed + j.est_credits > p.credit_cap then
    update render_jobs set status = 'blocked', failure_kind = 'cap',
      error = format('credit cap reached: %s committed + %s requested > cap %s', committed, j.est_credits, p.credit_cap),
      updated_at = now() where id = j.id;
    return jsonb_build_object('ok', false, 'reason', 'credit_cap', 'committed', committed, 'cap', p.credit_cap);
  end if;

  update render_jobs set status = 'submitting', updated_at = now() where id = j.id;
  return jsonb_build_object('ok', true, 'committed', committed, 'cap', p.credit_cap);
end $$;

-- Short-lived per-project lock so the cron, webhooks and page polling never
-- advance the same project at the same time.
create or replace function try_lock_project(p_project_id uuid, p_seconds integer default 55)
returns boolean language plpgsql as $$
declare got uuid;
begin
  update projects set tick_lock_until = now() + make_interval(secs => p_seconds)
    where id = p_project_id and tick_lock_until < now()
    returning id into got;
  return got is not null;
end $$;

create or replace function unlock_project(p_project_id uuid) returns void language sql as $$
  update projects set tick_lock_until = 'epoch' where id = p_project_id;
$$;

-- ---------------------------------------------------------------------------
-- Row level security: on everywhere, no policies (service role only).
-- ---------------------------------------------------------------------------
alter table business_profiles enable row level security;
alter table assets enable row level security;
alter table registry_meta enable row level security;
alter table model_registry enable row level security;
alter table model_pins enable row level security;
alter table projects enable row level security;
alter table storyboard_versions enable row level security;
alter table scenes enable row level security;
alter table router_decisions enable row level security;
alter table render_jobs enable row level security;
alter table qa_results enable row level security;
alter table final_videos enable row level security;
alter table audit_events enable row level security;

revoke execute on function claim_render_job(uuid) from public, anon, authenticated;
revoke execute on function try_lock_project(uuid, integer) from public, anon, authenticated;
revoke execute on function unlock_project(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private storage buckets. Files are served through short-lived signed URLs.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('assets', 'assets', false), ('media', 'media', false)
on conflict (id) do nothing;
