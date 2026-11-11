// Row shapes for the tables in db/migrations/0001_init.sql.
import type { Brief } from "./core/schemas";
import type { RegistryModel } from "./core/routing-rules";

export type { RegistryModel };

export interface Service {
  name: string;
  price: string;
  notes?: string;
}

export interface BusinessProfile {
  id: string;
  owner_id: string;
  name: string;
  business_type: "barbershop" | "salon";
  services: Service[];
  brand_colors: string[];
  logo_path: string | null;
  tone: string;
  address: string;
  booking_link: string;
  audience: string;
  extra_facts: string;
  credit_cap_default: number;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  business_id: string;
  storage_path: string;
  vertical_path: string | null;
  thumb_path: string | null;
  original_filename: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  orientation: "portrait" | "landscape" | "square" | null;
  area: string | null;
  angle: string | null;
  subject: string | null;
  description: string | null;
  shot_slot: string | null;
  tags: string[];
  people_visible: boolean;
  faces_visible: boolean;
  text_visible: boolean;
  quality_flags: string[];
  usable: boolean;
  tag_status: "pending" | "tagged" | "failed";
  tag_error: string | null;
  consent_confirmed: boolean;
  consent_at: string;
  created_at: string;
}

export type ProjectStatus = "brief" | "storyboard" | "approved" | "rendering" | "qa" | "needs_review" | "complete" | "failed";

export interface Project {
  id: string;
  business_id: string;
  title: string;
  original_prompt: string;
  brief: Brief | null;
  brief_warnings: string[];
  clarifying_question: string | null;
  clarifying_answer: string | null;
  status: ProjectStatus;
  current_version_id: string | null;
  credit_cap: number;
  first_prompt_at: string;
  created_at: string;
  updated_at: string;
}

export type VersionState = "draft" | "revised" | "approved" | "rendering" | "qa" | "complete" | "failed";

export interface StoryboardVersion {
  id: string;
  project_id: string;
  version: number;
  state: VersionState;
  parent_version_id: string | null;
  source: "generated" | "chat" | "inline";
  change_note: string;
  music_mood: string;
  rationale: string;
  total_runtime_s: number;
  est_credits: number;
  validation_warnings: string[];
  approved_by: string | null;
  approved_at: string | null;
  registry_version: number | null;
  failure_reason: string | null;
  created_at: string;
}

export type RenderStatus = "pending" | "not_needed" | "rendering" | "qa" | "passed" | "needs_review" | "rejected" | "failed";

export interface Scene {
  id: string;
  storyboard_version_id: string;
  scene_order: number;
  role: "hook" | "showcase" | "proof" | "cta";
  duration_s: number;
  background_asset_id: string | null;
  treatment: "animate" | "still_motion" | "end_card";
  shot_type: string;
  motion_prompt: string;
  model_prompt: string | null;
  subject_description: string | null;
  still_motion_effect: string | null;
  voiceover: string;
  on_screen_text: string;
  model_id: string | null;
  fallback_model_ids: string[];
  est_credits: number;
  render_key: string;
  route_flag: string | null;
  render_status: RenderStatus;
  clip_path: string | null;
  reused_from_scene_id: string | null;
  voiceover_path: string | null;
  voiceover_key: string | null;
  created_at: string;
}

export interface RouterDecisionRow {
  id: string;
  scene_id: string;
  storyboard_version_id: string;
  model_id: string | null;
  reason: string;
  fallback: string[];
  confidence: "high" | "medium" | "low" | "none";
  registry_version: number;
  source: "claude" | "pin" | "reused" | "ops";
  flagged: boolean;
  flag_reason: string | null;
  attempts: number;
  grade: "agree" | "disagree" | null;
  graded_by: string | null;
  grade_note: string | null;
  created_at: string;
}

export type JobStatus = "queued" | "submitting" | "submitted" | "in_progress" | "completed" | "failed" | "canceled" | "blocked";

export interface RenderJob {
  id: string;
  project_id: string;
  storyboard_version_id: string;
  scene_id: string;
  provider: "higgsfield" | "pika" | "mock";
  model_id: string;
  status: JobStatus;
  attempt: number;
  initiated_by: string;
  idempotency_key: string;
  provider_request_id: string | null;
  input: Record<string, unknown>;
  output_url: string | null;
  clip_path: string | null;
  est_credits: number;
  credits_used: number | null;
  error: string | null;
  failure_kind: "provider" | "qa" | "gate" | "cap" | null;
  last_polled_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QaResult {
  id: string;
  render_job_id: string | null;
  scene_id: string | null;
  final_video_id: string | null;
  kind: "scene" | "final";
  automated_scores: Record<string, unknown>;
  flags: string[];
  fidelity_score: number | null;
  overall: "pass" | "borderline" | "fail" | "error";
  summary: string;
  frame_paths: string[];
  needs_review: boolean;
  reviewer: string | null;
  decision: "approved" | "rejected" | "rerender" | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface FinalVideo {
  id: string;
  project_id: string;
  storyboard_version_id: string;
  status: "assembling" | "qa" | "passed" | "failed" | "needs_review" | "rejected";
  assembly_render_id: string | null;
  assembly_attempt: number;
  file_path: string | null;
  poster_path: string | null;
  duration_s: number | null;
  qa: Record<string, unknown>;
  error: string | null;
  assembly_cost_credits: number;
  export_count: number;
  last_exported_at: string | null;
  created_at: string;
  updated_at: string;
}
