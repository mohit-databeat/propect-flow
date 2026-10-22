"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Mail, Play, RotateCcw, Users, XCircle } from "lucide-react";
import { NODE_CATALOG, type WorkflowDraftDefinition, type WorkflowExecutionDto, type WorkflowNodeRunDto } from "@prospect/shared";
import { api, ApiError } from "../../../../../../../../lib/api";
import { Badge } from "../../../../../../../../components/ui/badge";
import { Button } from "../../../../../../../../components/ui/button";
import { Card, CardBody, CardHeader } from "../../../../../../../../components/ui/card";
import { useToast } from "../../../../../../../../components/ui/toast";
import { WorkflowCanvas, nodeTitle, type NodeDecoration } from "../../../../../../../../components/workflow-builder/workflow-canvas";
import { ACTIVE_RUN_STATUSES, formatDuration, formatValue, humanizeKey, latestByNode, nodeStatusLabel, nodeStatusTone, runStatusLabel, runStatusTone } from "../../../../../../../../components/workflow-builder/status";

const POLL_MS = 2000;

function countsText(run: WorkflowNodeRunDto): string | undefined {
  const outputs = Object.entries(run.outputCounts);
  if (run.status === "QUEUED") return undefined;
  const out = outputs.length > 0 ? ` → ${outputs.map(([h, n]) => (outputs.length > 1 ? `${h} ${n}` : `${n}`)).join(", ")}` : "";
  return `${run.inputCount} in${out}`;
}

export default function WorkflowRunPage() {
  const params = useParams<{ id: string; workflowId: string; runId: string }>();
  const { id: projectId, workflowId, runId } = params;
  const toast = useToast();
  const base = `/projects/${projectId}/workflow-executions/${runId}`;

  const [execution, setExecution] = useState<WorkflowExecutionDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acting, setActing] = useState<null | "cancel" | "retry" | "resume">(null);
  const pollFailures = useRef(0);
  const hasExecution = useRef(false);

  const load = useCallback(async () => {
    try {
      const fresh = await api.get<WorkflowExecutionDto>(base);
      setExecution(fresh);
      hasExecution.current = true;
      setLoadError(null);
      pollFailures.current = 0;
    } catch (e) {
      pollFailures.current += 1;
      if (!hasExecution.current || pollFailures.current >= 3) setLoadError(e instanceof ApiError ? e.message : "Failed to load the run");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [base]);

  const active = execution ? ACTIVE_RUN_STATUSES.has(execution.status) : true;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  const latest = useMemo(() => latestByNode(execution?.nodeRuns ?? []), [execution]);
  const decorations = useMemo(() => {
    const map = new Map<string, NodeDecoration>();
    for (const [id, run] of latest) map.set(id, { status: run.status, detail: countsText(run) });
    return map;
  }, [latest]);

  const focusIds = useMemo(() => {
    const runs = [...latest.values()];
    const current = runs.filter((x) => x.status === "RUNNING" || x.status === "WAITING" || x.status === "FAILED").map((x) => x.nodeId);
    if (current.length > 0) return current;
    const positions = new Map((execution?.definition.nodes ?? []).map((n) => [n.id, n.position.y]));
    const finished = runs.filter((x) => x.status === "SUCCEEDED" || x.status === "SKIPPED").sort((a, b) => (positions.get(b.nodeId) ?? 0) - (positions.get(a.nodeId) ?? 0));
    return finished[0] ? [finished[0].nodeId] : [];
  }, [latest, execution]);

  const act = async (kind: "cancel" | "retry" | "resume", path: string, success: string) => {
    setActing(kind);
    try {
      setExecution(await api.post<WorkflowExecutionDto>(`${base}/${path}`));
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "That action failed");
      await load();
    } finally {
      setActing(null);
    }
  };

  if (loadError && !execution) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600">{loadError}</p>
        <Link href={`/projects/${projectId}/workflows/${workflowId}`} className="text-sm text-brand-600 underline">Back to the workflow</Link>
      </div>
    );
  }
  if (!execution) return <p className="text-sm text-slate-500">Loading…</p>;

  const definition = execution.definition as unknown as WorkflowDraftDefinition;
  const selectedNode = definition.nodes.find((n) => n.id === selectedId) ?? null;
  const selectedAttempts = selectedId ? execution.nodeRuns.filter((r) => r.nodeId === selectedId).sort((a, b) => b.attempt - a.attempt) : [];
  const waiting = [...latest.values()].filter((r) => r.status === "WAITING");
  const statusCounts = [...latest.values()].reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/projects/${projectId}/workflows/${workflowId}`} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
            <ChevronLeft size={14} aria-hidden /> Workflow
          </Link>
          <h2 className="text-xl font-semibold text-slate-900">Run of version {execution.workflowVersion}</h2>
          <Badge tone={runStatusTone[execution.status]}>{runStatusLabel[execution.status]}</Badge>
          <span className="text-xs text-slate-400">Started {new Date(execution.createdAt).toLocaleString()}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {execution.status === "AWAITING_REVIEW" ? (
            <Link
              href={`/projects/${projectId}/emails`}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
            >
              <Mail size={14} aria-hidden /> Review emails
            </Link>
          ) : null}
          {execution.status === "FAILED" ? (
            <Button variant="secondary" disabled={acting !== null} onClick={() => void act("retry", "retry", "Retrying the failed step.")}>
              <RotateCcw size={14} /> {acting === "retry" ? "Retrying…" : "Retry failed step"}
            </Button>
          ) : null}
          {ACTIVE_RUN_STATUSES.has(execution.status) ? (
            <Button variant="danger" disabled={acting !== null} onClick={() => void act("cancel", "cancel", "Run cancelled.")}>
              <XCircle size={14} /> {acting === "cancel" ? "Cancelling…" : "Cancel run"}
            </Button>
          ) : null}
          <Link
            href={`/projects/${projectId}/prospects`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            <Users size={14} aria-hidden /> Prospects
          </Link>
        </div>
      </div>

      {execution.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{execution.error}</p>
      ) : null}
      {loadError ? <p role="status" className="text-xs text-amber-700">Live updates are paused: {loadError}</p> : null}

      {waiting.map((w) => (
        <Card key={w.id} className="border-amber-300">
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-700">
              <span className="font-medium">{nodeTitle(definition.nodes.find((n) => n.id === w.nodeId)!)}</span> is waiting for a decision on{" "}
              {String(w.summary.withDraft ?? w.inputCount)} email(s): {String(w.summary.approved ?? 0)} approved, {String(w.summary.pendingReview ?? 0)} undecided. Approve or reject each one on the Emails page, then continue.
            </div>
            <Button disabled={acting !== null} onClick={() => void act("resume", `nodes/${w.nodeId}/resume`, "Continuing the run.")}>
              <Play size={14} /> {acting === "resume" ? "Continuing…" : "Continue run"}
            </Button>
          </CardBody>
        </Card>
      ))}

      <p className="text-sm text-slate-500">
        {Object.entries(statusCounts)
          .map(([status, n]) => `${n} ${nodeStatusLabel[status as keyof typeof nodeStatusLabel].toLowerCase()}`)
          .join(" · ")}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <WorkflowCanvas definition={definition} readOnly selectedId={selectedId} decorations={decorations} focusNodeIds={focusIds} className="h-[560px] xl:h-[640px]" onSelect={setSelectedId} />

        <Card className="h-fit">
          <CardHeader className="text-sm font-medium text-slate-700">{selectedNode ? nodeTitle(selectedNode) : "Steps"}</CardHeader>
          <CardBody className="space-y-4">
            {!selectedNode ? (
              <ul className="space-y-1.5">
                {definition.nodes.map((n) => {
                  const run = latest.get(n.id);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(n.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        <span className="min-w-0 truncate">{nodeTitle(n)}</span>
                        {run ? <Badge tone={nodeStatusTone[run.status]}>{nodeStatusLabel[run.status]}</Badge> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{NODE_CATALOG[selectedNode.type].label}</div>
                {selectedAttempts.length === 0 ? <p className="text-sm text-slate-500">This step has not started.</p> : null}
                {selectedAttempts.map((attempt, i) => (
                  <div key={attempt.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-800">Attempt {attempt.attempt}{i === 0 ? " (latest)" : ""}</span>
                      <Badge tone={nodeStatusTone[attempt.status]}>{nodeStatusLabel[attempt.status]}</Badge>
                    </div>
                    <div className="text-xs text-slate-500">
                      {countsText(attempt) ?? "Not started"} · {formatDuration(attempt.durationMs)}
                    </div>
                    {attempt.error ? <p role="alert" className="rounded bg-red-50 px-2 py-1 text-sm text-red-700">{attempt.error}</p> : null}
                    {Object.keys(attempt.summary).length > 0 ? (
                      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                        {Object.entries(attempt.summary).map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="text-slate-500">{humanizeKey(k)}</dt>
                            <dd className="text-right font-medium text-slate-800">{formatValue(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {attempt.logs.length > 0 ? (
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-slate-600">Log ({attempt.logs.length})</summary>
                        <ol className="mt-1.5 space-y-1 text-xs">
                          {attempt.logs.map((l, idx) => (
                            <li key={idx} className={l.level === "error" ? "text-red-700" : l.level === "warn" ? "text-amber-700" : "text-slate-600"}>
                              <span className="mr-1.5 text-slate-400">{new Date(l.at).toLocaleTimeString()}</span>
                              {l.message}
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </div>
                ))}
                <Button variant="ghost" onClick={() => setSelectedId(null)}>Back to all steps</Button>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
