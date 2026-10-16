"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, XCircle, Loader2, MinusCircle, Circle, Play } from "lucide-react";
import type { WorkflowRunSummary, WorkflowStepSummary } from "@prospect/shared";
import { api, ApiError } from "../../../../../lib/api";
import { PageHeader } from "../../../../../components/layout/page-header";
import { Card, CardBody, CardHeader } from "../../../../../components/ui/card";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { useToast } from "../../../../../components/ui/toast";

const stepIcon = { QUEUED: Circle, RUNNING: Loader2, SUCCEEDED: CheckCircle2, FAILED: XCircle, SKIPPED: MinusCircle } as const;
const stepIconColor = { QUEUED: "text-slate-300", RUNNING: "text-blue-500", SUCCEEDED: "text-emerald-500", FAILED: "text-red-500", SKIPPED: "text-amber-400" } as const;

const ACTIVE_STATUSES = new Set(["PENDING", "RUNNING", "AWAITING_REVIEW"]);

const runStatusTone = {
  PENDING: "neutral",
  RUNNING: "info",
  AWAITING_REVIEW: "info",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "warning",
} as const;

const stepStatusTone = {
  QUEUED: "neutral",
  RUNNING: "info",
  SUCCEEDED: "success",
  FAILED: "danger",
  SKIPPED: "warning",
} as const;

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function WorkflowPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const toast = useToast();

  const [runs, setRuns] = useState<WorkflowRunSummary[] | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [refreshSources, setRefreshSources] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [acting, setActing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRuns = async (selectAfter?: string) => {
    try {
      const list = await api.get<WorkflowRunSummary[]>(`/projects/${projectId}/workflow-runs`);
      setRuns(list);
      if (selectAfter) setSelectedRunId(selectAfter);
      else if (!selectedRunId && list.length > 0) setSelectedRunId(list[0]!.id);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load workflow runs");
    }
  };

  useEffect(() => {
    void loadRuns();

  }, [projectId]);

  const selectedRun = runs?.find((r) => r.id === selectedRunId) ?? null;

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!selectedRunId || !selectedRun || !ACTIVE_STATUSES.has(selectedRun.status)) return;

    pollRef.current = setInterval(async () => {
      try {
        const fresh = await api.get<WorkflowRunSummary>(`/projects/${projectId}/workflow-runs/${selectedRunId}`);
        setRuns((prev) => (prev ? prev.map((r) => (r.id === fresh.id ? fresh : r)) : prev));
        if (!ACTIVE_STATUSES.has(fresh.status) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (e) {
        console.warn("Workflow run poll failed, will retry on next tick:", e);
      }
    }, 1500);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };

  }, [selectedRunId, selectedRun?.status]);

  const startRun = async () => {
    setStarting(true);
    setError(null);
    try {
      const { runId } = await api.post<{ runId: string }>(`/projects/${projectId}/workflow-runs`, { refreshSources });
      await loadRuns(runId);
      toast.success("Workflow run started.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to start workflow run";
      setError(message);
      toast.error(message);
    } finally {
      setStarting(false);
    }
  };

  const cancelRun = async () => {
    if (!selectedRunId) return;
    setActing(true);
    try {
      await api.post(`/projects/${projectId}/workflow-runs/${selectedRunId}/cancel`);
      await loadRuns(selectedRunId);
      toast.success("Workflow run cancelled.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to cancel run";
      setError(message);
      toast.error(message);
    } finally {
      setActing(false);
    }
  };

  const retryRun = async () => {
    if (!selectedRunId) return;
    setActing(true);
    try {
      await api.post(`/projects/${projectId}/workflow-runs/${selectedRunId}/retry`);
      await loadRuns(selectedRunId);
      toast.success("Workflow run retried.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to retry run";
      setError(message);
      toast.error(message);
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflow overview"
        description="Runs the full pipeline for real: normalize, qualify, enrich, re-qualify, generate outreach emails, and QA them. A step shows SKIPPED only when there's nothing for it to do (e.g. no missing fields to enrich, or no qualified company has a contact to email)."
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={refreshSources} onChange={(e) => setRefreshSources(e.target.checked)} />
              Refresh data sources first
            </label>
            <Button disabled={starting} onClick={startRun}>
              <Play size={15} /> {starting ? "Starting…" : "Run workflow"}
            </Button>
          </div>
        }
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="text-sm font-medium text-slate-700">Run history</CardHeader>
          <CardBody className="space-y-2">
            {runs?.length === 0 ? <p className="text-sm text-slate-400">No runs yet.</p> : null}
            {runs?.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedRunId(r.id)}
                className={`block w-full rounded-lg border p-2.5 text-left text-xs ${r.id === selectedRunId ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-slate-500">{r.id.slice(0, 8)}</span>
                  <Badge tone={runStatusTone[r.status]}>{r.status}</Badge>
                </div>
                <div className="mt-1 text-slate-400">{new Date(r.createdAt).toLocaleString()}</div>
              </button>
            ))}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Step timeline</span>
            {selectedRun ? (
              <div className="flex items-center gap-2">
                <Badge tone={runStatusTone[selectedRun.status]}>{selectedRun.status}</Badge>
                {selectedRun.status === "FAILED" ? (
                  <Button variant="secondary" disabled={acting} onClick={retryRun}>
                    Retry
                  </Button>
                ) : null}
                {ACTIVE_STATUSES.has(selectedRun.status) ? (
                  <Button variant="danger" disabled={acting} onClick={cancelRun}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
          <CardBody className="space-y-3">
            {!selectedRun ? <p className="text-sm text-slate-400">Select a run to see its steps.</p> : null}
            {selectedRun?.error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{selectedRun.error}</div> : null}
            {selectedRun?.summary && Object.keys(selectedRun.summary).length > 0 ? (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                {selectedRun.summary.normalize ? (
                  <div>
                    Normalize: {(selectedRun.summary.normalize as { newCompanies?: number }).newCompanies ?? 0} new compan
                    {(selectedRun.summary.normalize as { newCompanies?: number }).newCompanies === 1 ? "y" : "ies"} created
                    {(selectedRun.summary.normalize as { mergedIntoExisting?: number }).mergedIntoExisting ? (
                      <>
                        , {(selectedRun.summary.normalize as { mergedIntoExisting?: number }).mergedIntoExisting} record(s) matched by domain and merged into a company
                        already known from another source — not duplicates
                      </>
                    ) : null}
                  </div>
                ) : null}
                {selectedRun.summary.qualify ? (
                  <div>
                    Evaluated {(selectedRun.summary.qualify as { evaluated?: number }).evaluated ?? 0} companies — qualified{" "}
                    {(selectedRun.summary.qualify as { qualified?: number }).qualified ?? 0}, needs review{" "}
                    {(selectedRun.summary.qualify as { needsReview?: number }).needsReview ?? 0}, disqualified{" "}
                    {(selectedRun.summary.qualify as { disqualified?: number }).disqualified ?? 0}
                  </div>
                ) : null}
                {selectedRun.summary.enrich ? (
                  <div>
                    Enrichment: {(selectedRun.summary.enrich as { enrichmentCalls?: number }).enrichmentCalls ?? 0} call(s) on{" "}
                    {(selectedRun.summary.enrich as { eligible?: number }).eligible ?? 0} eligible prospect(s) (
                    {(selectedRun.summary.enrich as { skippedHardFail?: number }).skippedHardFail ?? 0} skipped, already disqualified) — fields requested{" "}
                    {(selectedRun.summary.enrich as { fieldsRequested?: number }).fieldsRequested ?? 0}, found{" "}
                    {(selectedRun.summary.enrich as { fieldsFound?: number }).fieldsFound ?? 0}, unavailable{" "}
                    {(selectedRun.summary.enrich as { fieldsUnavailable?: number }).fieldsUnavailable ?? 0}
                  </div>
                ) : null}
                {selectedRun.summary.requalify ? (
                  <div>
                    Re-qualification: qualified {(selectedRun.summary.requalify as { qualified?: number }).qualified ?? 0}, needs review{" "}
                    {(selectedRun.summary.requalify as { needsReview?: number }).needsReview ?? 0}, disqualified{" "}
                    {(selectedRun.summary.requalify as { disqualified?: number }).disqualified ?? 0} — LLM assessments{" "}
                    {(selectedRun.summary.requalify as { llmAssessments?: number }).llmAssessments ?? 0}, cached{" "}
                    {(selectedRun.summary.requalify as { cachedAssessments?: number }).cachedAssessments ?? 0}, cap reached{" "}
                    {(selectedRun.summary.requalify as { llmCapReached?: number }).llmCapReached ?? 0}, unknown (missing evidence){" "}
                    {(selectedRun.summary.requalify as { unknownDueToMissingEvidence?: number }).unknownDueToMissingEvidence ?? 0}
                  </div>
                ) : null}
              </div>
            ) : null}
            {selectedRun?.steps.map((s: WorkflowStepSummary) => {
              const Icon = stepIcon[s.status];
              return (
                <div key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                  <Icon size={18} className={`shrink-0 ${stepIconColor[s.status]} ${s.status === "RUNNING" ? "animate-spin" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800">{s.stepKey.replace("_", " ")}</div>
                    {s.error ? <div className="mt-0.5 truncate text-xs text-slate-500">{s.error}</div> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-slate-400">
                    <span>{formatDuration(s.durationMs)}</span>
                    <Badge tone={stepStatusTone[s.status]}>{s.status}</Badge>
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
