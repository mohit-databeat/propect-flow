"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageSquare, Database, Workflow, Users, Mail, Megaphone, BarChart3, ArrowRight, Compass, X } from "lucide-react";

export const PROJECT_STEPS = [
  { key: "icp", label: "ICP", icon: MessageSquare, blurb: "Describe your ideal customer in plain English and let the AI turn it into scoreable criteria." },
  { key: "data-sources", label: "Data Sources", icon: Database, blurb: "Bring in companies to evaluate — upload a CSV or connect a data source." },
  { key: "workflow", label: "Workflow", icon: Workflow, blurb: "Run the pipeline: normalize data, qualify companies, enrich gaps, and draft outreach." },
  { key: "prospects", label: "Prospects", icon: Users, blurb: "Review every company's status, score, and the exact evidence behind each verdict." },
  { key: "emails", label: "Emails", icon: Mail, blurb: "Review AI-drafted, QA-checked emails — approve, edit, or reject before anything goes out." },
  { key: "campaigns", label: "Campaigns", icon: Megaphone, blurb: "Group approved emails into a campaign and send (simulated — nothing real is delivered)." },
  { key: "analytics", label: "Analytics", icon: BarChart3, blurb: "See the full funnel and quality metrics, computed live from real data." },
] as const;

const TOUR_SEEN_KEY = "pf_tour_dismissed";
const visitedKey = (projectId: string) => `pf_visited_${projectId}`;

export function PipelineStepper({ projectId, pathname }: { projectId: string; pathname: string }) {
  const router = useRouter();
  const [tourActive, setTourActive] = useState(false);
  const [visited, setVisited] = useState<Set<string>>(new Set());

  const currentIndex = PROJECT_STEPS.findIndex((s) => pathname.startsWith(`/projects/${projectId}/${s.key}`));
  const current = currentIndex === -1 ? PROJECT_STEPS[0] : PROJECT_STEPS[currentIndex];
  const next = currentIndex >= 0 && currentIndex < PROJECT_STEPS.length - 1 ? PROJECT_STEPS[currentIndex + 1] : null;

  useEffect(() => {
    try {
      if (!localStorage.getItem(TOUR_SEEN_KEY)) setTourActive(true);
    } catch (e) {
      console.warn("Failed to read tour-seen state from localStorage:", e);
    }
  }, []);

  useEffect(() => {
    if (currentIndex === -1) return;
    const stepKey = PROJECT_STEPS[currentIndex]!.key;
    try {
      const stored = JSON.parse(localStorage.getItem(visitedKey(projectId)) ?? "[]") as string[];
      const updated = new Set(stored);
      if (!updated.has(stepKey)) {
        updated.add(stepKey);
        localStorage.setItem(visitedKey(projectId), JSON.stringify([...updated]));
      }
      setVisited(updated);
    } catch {
      setVisited((prev) => new Set(prev).add(stepKey));
    }
  }, [projectId, currentIndex]);

  const dismissTour = () => {
    setTourActive(false);
    try {
      localStorage.setItem(TOUR_SEEN_KEY, "1");
    } catch (e) {
      console.warn("Failed to persist tour-seen state to localStorage:", e);
    }
  };

  const goNext = () => {
    if (next) router.push(`/projects/${projectId}/${next.key}`);
  };

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <ol className="flex flex-1 items-center">
          {PROJECT_STEPS.map((step, i) => {
            const Icon = step.icon;
            const isReached = (key: string) => visited.has(key) || PROJECT_STEPS[currentIndex]?.key === key;
            const state = i === currentIndex ? "active" : visited.has(step.key) ? "visited" : "upcoming";
            const lineReached = i < PROJECT_STEPS.length - 1 && isReached(step.key) && isReached(PROJECT_STEPS[i + 1]!.key);
            return (
              <li key={step.key} className="flex flex-1 items-center last:flex-none">
                <Link href={`/projects/${projectId}/${step.key}`} className="group flex flex-col items-center gap-1.5" title={step.label}>
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors ${
                      state === "visited"
                        ? "border-brand-500 bg-white text-brand-600"
                        : state === "active"
                          ? "animate-pulse-glow border-brand-600 bg-white text-brand-700"
                          : "border-slate-300 bg-white text-slate-400 group-hover:border-slate-400 group-hover:text-slate-600"
                    }`}
                  >
                    <Icon size={16} strokeWidth={2} />
                  </span>
                  <span className={`text-[11px] font-medium ${state === "active" ? "text-brand-700" : state === "visited" ? "text-slate-700" : "text-slate-400"}`}>{step.label}</span>
                </Link>
                {i < PROJECT_STEPS.length - 1 ? <span className={`mx-1.5 mb-4 h-0.5 flex-1 ${lineReached ? "bg-brand-500" : "bg-slate-200"}`} /> : null}
              </li>
            );
          })}
        </ol>

        <div className="flex shrink-0 items-center gap-2">
          {!tourActive ? (
            <button
              onClick={() => setTourActive(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <Compass size={14} /> Guide me
            </button>
          ) : null}
          {next ? (
            <button
              onClick={goNext}
              className={`flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 ${tourActive ? "animate-pulse-glow ring-2 ring-brand-300 ring-offset-2" : ""}`}
            >
              Next: {next.label} <ArrowRight size={14} />
            </button>
          ) : null}
        </div>
      </div>

      {tourActive ? (
        <div className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
          <Compass size={18} className="mt-0.5 shrink-0 text-brand-600" />
          <div className="flex-1">
            <div className="mb-0.5 text-xs font-medium text-brand-700">
              Step {currentIndex === -1 ? 1 : currentIndex + 1} of {PROJECT_STEPS.length} — {current!.label}
            </div>
            <p className="text-sm text-slate-700">{current!.blurb}</p>
          </div>
          <button onClick={dismissTour} className="shrink-0 rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600" title="Dismiss guide">
            <X size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
