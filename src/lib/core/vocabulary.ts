// Fixed vocabularies shared by Claude prompts, validation, the registry and the UI.

/** Motion / content tags used by the registry's best_for and avoid_for (PRD 5.2). */
export const MOTION_TAGS = [
  "camera_push",
  "environment_motion",
  "hair_close_up",
  "hands_with_tools",
  "back_of_person",
  "face_visible",
  "wide_interior",
  "storefront_exterior",
  "subtle_light_change",
  "product_detail",
] as const;
export type MotionTag = (typeof MOTION_TAGS)[number];

export const AREAS = [
  "storefront",
  "interior_wide",
  "chair_mirror",
  "sign",
  "workstation",
  "finished_cut",
  "products",
  "wash_station",
  "waiting_area",
  "detail",
  "other",
] as const;
export type Area = (typeof AREAS)[number];

export const ANGLES = ["wide", "medium", "close_up", "over_the_shoulder", "from_behind", "top_down", "front"] as const;
export type Angle = (typeof ANGLES)[number];

export const SHOT_TYPES = [
  "close_up",
  "over_the_shoulder",
  "from_behind",
  "wide",
  "detail",
  "medium",
  "hands_and_hair",
] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export const TREATMENTS = ["animate", "still_motion", "end_card"] as const;
export type Treatment = (typeof TREATMENTS)[number];

export const SCENE_ROLES = ["hook", "showcase", "proof", "cta"] as const;
export type SceneRole = (typeof SCENE_ROLES)[number];

/** Free photo-motion effects built in assembly (Ken Burns style). */
export const STILL_EFFECTS = [
  "zoomIn",
  "zoomInSlow",
  "zoomOut",
  "zoomOutSlow",
  "slideLeftSlow",
  "slideRightSlow",
  "slideUpSlow",
  "slideDownSlow",
] as const;
export type StillEffect = (typeof STILL_EFFECTS)[number];

export const QUALITY_ISSUES = [
  "blurry",
  "too_dark",
  "overexposed",
  "cluttered",
  "watermark",
  "screenshot",
  "heavy_filter",
] as const;

export const GOALS = ["promo", "new_service", "before_after", "brand_awareness", "event"] as const;
export type Goal = (typeof GOALS)[number];

export const PLATFORMS = ["instagram_reels", "tiktok", "both"] as const;

/** Shots the onboarding asks for (FR-3, PRD 3.1). */
export const REQUIRED_SHOTS: { slot: Area; label: string; hint: string; needsConsent?: boolean }[] = [
  { slot: "storefront", label: "Storefront", hint: "Outside, showing the entrance in daylight." },
  { slot: "interior_wide", label: "Interior wide", hint: "The whole room from a corner, lights on." },
  { slot: "chair_mirror", label: "Chair and mirror", hint: "A styling chair with its mirror and station." },
  { slot: "sign", label: "Sign", hint: "Your sign or logo on the wall or window." },
  { slot: "workstation", label: "Workstation", hint: "Tools laid out: clippers, combs, products." },
  {
    slot: "finished_cut",
    label: "Finished cuts",
    hint: "A finished cut or style, back or side view works best.",
    needsConsent: true,
  },
];

/** Library minimum before videos can be generated (PRD 3.1 proposal). */
export const LIBRARY_MINIMUM = { photos: 6, areas: 4 } as const;

/** Quality flags computed in code from image metadata. */
export const MIN_SHORT_SIDE_PX = 720;

/** Storyboard targets (PRD 6.2). */
export const STORYBOARD_LIMITS = {
  minScenes: 3,
  maxScenes: 5,
  hookMaxSeconds: 3,
  targetMinSeconds: 10,
  targetMaxSeconds: 15,
  hardMinSeconds: 6,
  hardMaxSeconds: 30,
  sceneMinSeconds: 1,
  sceneMaxSeconds: 8,
  wordsPerSecond: 2.8,
  overlayMaxChars: 90,
} as const;

/** Retry policy (FR-27). Fallback model is used on the last attempt. */
export const MAX_RENDER_ATTEMPTS = 3;

/** 1 credit = $0.01. */
export const USD_PER_CREDIT = 0.01;

const LABELS: Record<string, string> = { cta: "CTA", qa: "QA", ui: "UI" };

export function labelFor(value: string): string {
  if (LABELS[value]) return LABELS[value];
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
