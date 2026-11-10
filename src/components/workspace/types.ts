import type { ProjectSnapshot, SceneView } from "@/lib/server/pipeline/snapshot";

export type { ProjectSnapshot, SceneView };

export interface LibraryPhoto {
  id: string;
  thumb_url: string | null;
  photo_url: string | null;
  subject: string;
  area: string;
  usable: boolean;
}

export interface Brand {
  primary: string;
  accent: string;
  name: string;
  booking: string;
}

export const EFFECT_ANIMATION: Record<string, string> = {
  zoomIn: "kb-zoom-in",
  zoomInSlow: "kb-zoom-in",
  zoomInFast: "kb-zoom-in",
  zoomOut: "kb-zoom-out",
  zoomOutSlow: "kb-zoom-out",
  zoomOutFast: "kb-zoom-out",
  slideLeftSlow: "kb-left",
  slideRightSlow: "kb-right",
  slideUpSlow: "kb-up",
  slideDownSlow: "kb-down",
};

export const TREATMENT_LABEL: Record<string, string> = {
  animate: "AI-animated",
  still_motion: "Photo motion",
  end_card: "End card",
};
