import "server-only";
import { db, must } from "../db";
import { USD_PER_CREDIT } from "../../core/vocabulary";

export interface Metric {
  name: string;
  definition: string;
  target: string;
  value: string;
  ok: boolean | null;
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`);

/** Success metrics from PRD section 10, computed from the audit data. */
export async function computeMetrics(): Promise<Metric[]> {
  const [decisions, versions, projects, jobs, qa, finals] = await Promise.all([
    db().from("router_decisions").select("grade, source"),
    db().from("storyboard_versions").select("project_id, version, approved_at, created_at"),
    db().from("projects").select("id, first_prompt_at, status"),
    db().from("render_jobs").select("id, scene_id, attempt, status, credits_used, est_credits, project_id"),
    db().from("qa_results").select("kind, overall, render_job_id, needs_review, fidelity_score, automated_scores, final_video_id"),
    db().from("final_videos").select("id, project_id, status, export_count, assembly_cost_credits"),
  ]);
  const d = must(decisions, "decisions") as { grade: string | null; source: string }[];
  const v = must(versions, "versions") as { project_id: string; version: number; approved_at: string | null; created_at: string }[];
  const p = must(projects, "projects") as { id: string; first_prompt_at: string; status: string }[];
  const j = must(jobs, "jobs") as { id: string; scene_id: string; attempt: number; status: string; credits_used: number | null; est_credits: number; project_id: string }[];
  const q = must(qa, "qa") as { kind: string; overall: string; render_job_id: string | null; needs_review: boolean; fidelity_score: number | null; automated_scores: Record<string, unknown>; final_video_id: string | null }[];
  const f = must(finals, "finals") as { id: string; project_id: string; status: string; export_count: number; assembly_cost_credits: number }[];

  const graded = d.filter((x) => x.grade);
  const agree = graded.filter((x) => x.grade === "agree").length;

  const approvals = v.filter((x) => x.approved_at);
  const firstPrompt = new Map(p.map((x) => [x.id, new Date(x.first_prompt_at).getTime()]));
  const approvalMinutes = approvals
    .map((a) => (new Date(a.approved_at!).getTime() - (firstPrompt.get(a.project_id) ?? 0)) / 60000)
    .filter((m) => m >= 0);
  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const medMin = median(approvalMinutes);
  const avgVersions = approvals.length ? approvals.reduce((s, a) => s + a.version, 0) / approvals.length : null;

  const firstAttempts = j.filter((x) => x.attempt === 1);
  const firstIds = new Set(firstAttempts.map((x) => x.id));
  const firstQa = q.filter((x) => x.kind === "scene" && x.render_job_id && firstIds.has(x.render_job_id));
  const firstPass = firstQa.filter((x) => x.overall === "pass").length;

  const delivered = f.filter((x) => x.status === "passed");
  const deliveredProjects = new Set(delivered.map((x) => x.project_id));
  const reviewedProjects = new Set(
    j.filter((x) => q.some((r) => r.render_job_id === x.id && (r.needs_review || r.overall !== "pass"))).map((x) => x.project_id),
  );
  const needingHuman = [...deliveredProjects].filter((id) => reviewedProjects.has(id)).length;

  const sceneQa = q.filter((x) => x.kind === "scene" && x.fidelity_score !== null);
  const fidelityPass = sceneQa.filter((x) => (x.fidelity_score ?? 0) >= 4 && !((x.automated_scores?.pixel_similarity as number | null) !== null && (x.automated_scores?.pixel_similarity as number) < 0.55)).length;

  const spendByProject = new Map<string, number>();
  for (const x of j) spendByProject.set(x.project_id, (spendByProject.get(x.project_id) ?? 0) + Number(x.credits_used ?? 0));
  const costs = [...deliveredProjects].map((id) => spendByProject.get(id) ?? 0);
  const avgCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;

  const exported = delivered.filter((x) => x.export_count > 0).length;

  return [
    { name: "Router accuracy", definition: "Share of graded router picks a reviewer agrees with", target: "85% or higher", value: graded.length ? `${pct(agree, graded.length)} of ${graded.length}` : "No grades yet", ok: graded.length ? agree / graded.length >= 0.85 : null },
    { name: "Time to approval", definition: "Prompt entered to storyboard approved (median)", target: "Under 5 minutes", value: medMin === null ? "n/a" : `${medMin.toFixed(1)} min`, ok: medMin === null ? null : medMin < 5 },
    { name: "Revisions per approval", definition: "Storyboard versions created before approval (average)", target: "2 or fewer", value: avgVersions === null ? "n/a" : avgVersions.toFixed(1), ok: avgVersions === null ? null : avgVersions <= 2 },
    { name: "First-pass render success", definition: "Animated scenes passing automated QA on attempt 1", target: "70% or higher", value: firstQa.length ? `${pct(firstPass, firstQa.length)} of ${firstQa.length}` : "n/a", ok: firstQa.length ? firstPass / firstQa.length >= 0.7 : null },
    { name: "Human-review rate", definition: "Delivered videos that needed a human reviewer", target: "Under 20%", value: deliveredProjects.size ? pct(needingHuman, deliveredProjects.size) : "n/a", ok: deliveredProjects.size ? needingHuman / deliveredProjects.size < 0.2 : null },
    { name: "Background fidelity", definition: "Animated scenes passing the source-photo fidelity check", target: "95% or higher", value: sceneQa.length ? `${pct(fidelityPass, sceneQa.length)} of ${sceneQa.length}` : "n/a", ok: sceneQa.length ? fidelityPass / sceneQa.length >= 0.95 : null },
    { name: "Cost per finished video", definition: "Render credits per delivered video (average)", target: "Set after benchmark", value: avgCost === null ? "n/a" : `${avgCost.toFixed(1)} credits ($${(avgCost * USD_PER_CREDIT).toFixed(2)})`, ok: null },
    { name: "Owner adoption", definition: "Delivered videos that owners export", target: "Set after launch", value: delivered.length ? pct(exported, delivered.length) : "n/a", ok: null },
  ];
}
