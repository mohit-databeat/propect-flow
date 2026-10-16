"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { RefreshCw, Sparkles, Mail, Pencil, Check, X, RotateCw } from "lucide-react";
import type { AttributeHistoryResponse, MessageDto, ProspectDetail, QualificationResultDto } from "@prospect/shared";
import { api, ApiError } from "../../../../../../lib/api";
import { PageHeader } from "../../../../../../components/layout/page-header";
import { Card, CardBody } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import { Textarea } from "../../../../../../components/ui/textarea";
import { useToast } from "../../../../../../components/ui/toast";

const TABS = ["Overview", "Source Data", "Normalized", "ICP Results", "Enrichment", "AI Reasoning", "Emails"] as const;
type Tab = (typeof TABS)[number];

const statusTone = { PENDING: "neutral", QUALIFIED: "success", DISQUALIFIED: "danger", NEEDS_REVIEW: "warning" } as const;
const verdictTone = { PASS: "success", FAIL: "danger", UNKNOWN: "neutral" } as const;

export default function ProspectDetailPage() {
  const params = useParams<{ id: string; prospectId: string }>();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("Overview");
  const [detail, setDetail] = useState<ProspectDetail | null>(null);
  const [history, setHistory] = useState<AttributeHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"enrich" | "requalify" | null>(null);

  const load = () => {
    api
      .get<ProspectDetail>(`/projects/${params.id}/prospects/${params.prospectId}`)
      .then(setDetail)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load prospect"));
    api
      .get<AttributeHistoryResponse>(`/projects/${params.id}/prospects/${params.prospectId}/attributes`)
      .then(setHistory)
      .catch((e) => console.warn("Failed to load attribute history:", e));
  };

  useEffect(load, [params.id, params.prospectId]);

  const runAction = async (action: "enrich" | "requalify") => {
    setBusy(action);
    setError(null);
    try {
      const updated = await api.post<ProspectDetail>(`/projects/${params.id}/prospects/${params.prospectId}/${action}`);
      setDetail(updated);
      toast.success(action === "enrich" ? "Enrichment complete." : "Prospect re-qualified.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : `Failed to ${action}`;
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!detail) return <p className="text-sm text-slate-500">Loading…</p>;

  const hasMissingFields = ((detail.summary as { missingFields?: string[] }).missingFields?.length ?? 0) > 0;
  const hasRequiredFail = ((detail.summary as { requiredFails?: string[] }).requiredFails?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-sm font-semibold text-brand-700">
              {detail.company.name.trim()[0]?.toUpperCase() ?? "?"}
            </div>
            {detail.company.name}
          </div>
        }
        description={detail.company.domain ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={statusTone[detail.status as keyof typeof statusTone] ?? "neutral"}>{detail.status}</Badge>
            <Badge tone="neutral">{detail.score === null ? "— (insufficient evidence)" : `${detail.score}/100`}</Badge>
            <Badge tone="info">coverage {detail.coverage ?? 0}%</Badge>
            <Button variant="secondary" disabled={busy !== null || hasRequiredFail || !hasMissingFields} onClick={() => runAction("enrich")}>
              <RefreshCw size={14} className={busy === "enrich" ? "animate-spin" : ""} /> {busy === "enrich" ? "Enriching…" : "Enrich missing fields"}
            </Button>
            <Button variant="secondary" disabled={busy !== null} onClick={() => runAction("requalify")}>
              <Sparkles size={14} className={busy === "requalify" ? "animate-pulse" : ""} /> {busy === "requalify" ? "Re-qualifying…" : "Re-qualify"}
            </Button>
          </div>
        }
      />

      <nav className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Overview" ? <OverviewTab detail={detail} /> : null}
      {tab === "Source Data" ? <SourceDataTab detail={detail} /> : null}
      {tab === "Normalized" ? <NormalizedTab detail={detail} history={history} /> : null}
      {tab === "ICP Results" ? <IcpResultsTab detail={detail} /> : null}
      {tab === "Enrichment" ? <EnrichmentTab detail={detail} /> : null}
      {tab === "AI Reasoning" ? <AiReasoningTab detail={detail} /> : null}
      {tab === "Emails" ? <EmailsTab detail={detail} projectId={params.id} onChange={load} /> : null}
    </div>
  );
}

function OverviewTab({ detail }: { detail: ProspectDetail }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardBody>
          <div className="text-xs text-slate-500">Industry</div>
          <div className="text-sm text-slate-800">{detail.company.industry ?? "—"}</div>
          {detail.company.industryRaw ? <div className="text-xs text-slate-400">raw: {detail.company.industryRaw}</div> : null}
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <div className="text-xs text-slate-500">Country</div>
          <div className="text-sm text-slate-800">{detail.company.country ?? "—"}</div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <div className="text-xs text-slate-500">Employees</div>
          <div className="text-sm text-slate-800">{detail.company.employeeCount ?? detail.company.employeeRange ?? "—"}</div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <div className="text-xs text-slate-500">Revenue</div>
          <div className="text-sm text-slate-800">{detail.company.revenueUsd ? `$${detail.company.revenueUsd.toLocaleString()}` : (detail.company.revenueRange ?? "—")}</div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <div className="text-xs text-slate-500">Tech stack</div>
          <div className="flex flex-wrap gap-1">{detail.company.techStack.map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}</div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <div className="text-xs text-slate-500">People</div>
          <div className="text-sm text-slate-800">{detail.people.length} contact(s)</div>
        </CardBody>
      </Card>
    </div>
  );
}

function SourceDataTab({ detail }: { detail: ProspectDetail }) {
  return (
    <div className="space-y-3">
      {detail.sourceRecords.length === 0 ? <p className="text-sm text-slate-400">No raw source records.</p> : null}
      {detail.sourceRecords.map((r) => (
        <Card key={r.id}>
          <CardBody>
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
              <Badge tone="neutral">{r.providerKey}</Badge>
              <span>{r.dataSourceName}</span>
              <span>· fetched {new Date(r.fetchedAt).toLocaleString()}</span>
            </div>
            <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(r.rawPayload, null, 2)}</pre>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function NormalizedTab({ detail, history }: { detail: ProspectDetail; history: AttributeHistoryResponse | null }) {
  return (
    <div className="space-y-3">
      <Card>
        <CardBody>
          <p className="mb-2 text-xs font-medium text-slate-500">Current canonical snapshot</p>
          <pre className="max-h-80 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(detail.company.canonical, null, 2)}</pre>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <p className="mb-3 text-xs font-medium text-slate-500">Attribute history (append-only ledger)</p>
          <div className="space-y-3">
            {history?.fields.map((f) => (
              <div key={f.field} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-1 font-mono text-xs text-slate-600">{f.field}</div>
                <div className="space-y-1">
                  {f.observations.map((o) => (
                    <div key={o.id} className={`flex items-center justify-between rounded px-2 py-1 text-xs ${o.isCurrentWinner ? "bg-emerald-50" : "bg-slate-50"}`}>
                      <span className="truncate">{typeof o.value === "object" ? JSON.stringify(o.value) : String(o.value)}</span>
                      <span className="ml-2 flex shrink-0 items-center gap-2 text-slate-400">
                        {o.isCurrentWinner ? <Badge tone="success">current</Badge> : null}
                        <Badge tone="neutral">{o.sourceType}</Badge>
                        <span>{o.providerKey}</span>
                        <span>conf {o.confidence}</span>
                        <span>{new Date(o.observedAt).toLocaleDateString()}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function IcpResultsTab({ detail }: { detail: ProspectDetail }) {
  const byCriterion = new Map<string, { label: string; initial?: QualificationResultDto; post?: QualificationResultDto }>();
  for (const r of detail.results) {
    const entry = byCriterion.get(r.criterionId) ?? { label: r.criterionLabel };
    if (r.phase === "INITIAL") entry.initial = r;
    else entry.post = r;
    byCriterion.set(r.criterionId, entry);
  }

  return (
    <div className="space-y-2">
      {[...byCriterion.entries()].map(([criterionId, { label, initial, post }]) => (
        <Card key={criterionId}>
          <CardBody>
            <div className="mb-2 text-sm font-medium text-slate-900">{label}</div>
            <div className={`grid grid-cols-1 gap-3 ${post ? "sm:grid-cols-2" : ""}`}>
              {initial ? <ResultColumn label="Before enrichment (INITIAL)" result={initial} /> : null}
              {post ? <ResultColumn label="After enrichment (POST_ENRICHMENT)" result={post} highlight={initial ? initial.status !== post.status : false} /> : null}
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function ResultColumn({ label, result, highlight }: { label: string; result: QualificationResultDto; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-brand-300 bg-brand-50" : "border-slate-200"}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge tone={result.required ? "danger" : "neutral"}>{result.required ? "Required" : "Soft"}</Badge>
          <Badge tone="info">weight {result.weight}</Badge>
          <Badge tone={verdictTone[result.status]}>{result.status}</Badge>
        </div>
      </div>
      <p className="text-xs text-slate-600">{result.reason}</p>
      {result.confidence !== null ? <div className="mt-1 text-xs text-slate-400">confidence {result.confidence}</div> : null}
      {result.evidence.length > 0 ? (
        <div className="mt-2 space-y-1">
          {result.evidence.map((e) => (
            <div key={e.id} className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-500">
              evidence: {JSON.stringify(e.content)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EnrichmentTab({ detail }: { detail: ProspectDetail }) {
  return (
    <div className="space-y-3">
      <Card>
        <CardBody>
          <p className="mb-2 text-xs font-medium text-slate-500">Enrichment runs</p>
          {detail.enrichmentRuns.length === 0 ? <p className="text-sm text-slate-400">No enrichment has been attempted for this prospect yet.</p> : null}
          <div className="space-y-2">
            {detail.enrichmentRuns.map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium text-slate-700">{r.providerKey}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={r.status === "SUCCEEDED" ? "success" : r.status === "FAILED" ? "danger" : "warning"}>{r.status}</Badge>
                    <span className="text-slate-400">{r.costUnits} unit(s)</span>
                  </div>
                </div>
                <div className="text-slate-500">requested: {r.requestedFields.join(", ") || "—"}</div>
                <div className="text-emerald-600">found: {r.suppliedFields.join(", ") || "—"}</div>
                <div className="text-amber-600">unavailable: {r.unavailableFields.join(", ") || "—"}</div>
                {r.error ? <div className="mt-1 text-red-600">{r.error}</div> : null}
                <div className="mt-1 text-slate-400">
                  {new Date(r.startedAt).toLocaleString()} {r.durationMs !== null ? `· ${r.durationMs}ms` : ""}
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <p className="mb-2 text-xs font-medium text-slate-500">Qualitative (LLM) assessments</p>
          {detail.aiRuns.length === 0 ? <p className="text-sm text-slate-400">No qualitative assessment has run for this prospect yet.</p> : null}
          <div className="space-y-2">
            {detail.aiRuns.map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium text-slate-700">{r.criterionId ?? "—"}</span>
                  <div className="flex items-center gap-1.5">
                    {r.cached ? <Badge tone="info">cached</Badge> : null}
                    <Badge tone={r.status === "SUCCEEDED" ? "success" : "danger"}>{r.status}</Badge>
                  </div>
                </div>
                <div className="text-slate-500">
                  {r.providerKey} / {r.model} · tokens {r.inputTokens}+{r.outputTokens}
                  {r.latencyMs !== null ? ` · ${r.latencyMs}ms` : ""}
                </div>
                <div className="mt-1 text-slate-400">{new Date(r.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function AiReasoningTab({ detail }: { detail: ProspectDetail }) {
  const pendingQualitative = detail.results.some((r) => r.evaluator === "LLM" && r.phase === "INITIAL" && r.reason.includes("pending POST_ENRICHMENT"));
  return (
    <Card>
      <CardBody className="space-y-3">
        <pre className="whitespace-pre-wrap text-sm text-slate-700">{detail.aiReasoning ?? "No reasoning available."}</pre>
        {pendingQualitative ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
            Qualitative (AI-assessed) criteria are UNKNOWN in this run's most recent phase, pending enrichment and re-qualification. Use "Re-qualify" above once relevant fields are enriched.
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

const qaTone = { PENDING: "neutral", PASS: "success", WARN: "warning", FAIL: "danger" } as const;
const reviewTone = { PENDING: "neutral", APPROVED: "success", REJECTED: "danger", EDITED: "info" } as const;

function EmailsTab({ detail, projectId, onChange }: { detail: ProspectDetail; projectId: string; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ subject: string; body: string } | null>(null);

  const message = detail.messages[0] as MessageDto | undefined;
  const canGenerate = detail.status === "QUALIFIED";

  const run = async (fn: () => Promise<unknown>, successMessage = "Action complete.") => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
      toast.success(successMessage);
    } catch (e) {
      const errMessage = e instanceof ApiError ? e.message : "Action failed";
      setError(errMessage);
      toast.error(errMessage);
    } finally {
      setBusy(false);
    }
  };

  if (!message) {
    return (
      <Card>
        <CardBody className="space-y-3 py-12 text-center">
          <p className="text-sm text-slate-500">
            {canGenerate ? "No outreach email has been generated for this prospect yet." : "Only QUALIFIED prospects are eligible for outreach email generation."}
          </p>
          {canGenerate ? (
            <Button
              disabled={busy}
              onClick={() => run(() => api.post(`/projects/${projectId}/prospects/${detail.id}/messages/generate`), "Email generated.")}
            >
              <Mail size={14} /> {busy ? "Generating…" : "Generate email"}
            </Button>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </CardBody>
      </Card>
    );
  }

  const startEdit = () => setEditing({ subject: message.subject, body: message.body });
  const saveEdit = () => {
    if (!editing) return;
    void run(() => api.patch(`/projects/${projectId}/messages/${message.id}`, editing), "Edit saved — QA will need to re-run.").then(() => setEditing(null));
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Mail size={14} />
              To: {message.recipientName ?? "—"} {message.recipientTitle ? `(${message.recipientTitle})` : ""} · {message.toAddress ?? "no email"}
            </div>
            <div className="flex items-center gap-1.5">
              <Badge tone={qaTone[message.qaStatus]}>QA: {message.qaStatus}</Badge>
              <Badge tone={reviewTone[message.reviewStatus]}>{message.reviewStatus}</Badge>
            </div>
          </div>

          {editing ? (
            <div className="space-y-2">
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                value={editing.subject}
                onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
              />
              <Textarea rows={8} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
              <div className="flex gap-2">
                <Button disabled={busy} onClick={saveEdit}>
                  <Check size={14} /> Save (resets QA)
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 font-medium text-slate-900">{message.subject}</div>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{message.body}</p>
            </div>
          )}

          {message.personalizationPoints.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {message.personalizationPoints.map((p) => (
                <Badge key={p} tone="info">
                  {p}
                </Badge>
              ))}
            </div>
          ) : null}

          {message.qaResult ? (
            <div className={`rounded-lg border p-3 text-xs ${message.qaResult.verdict === "FAIL" ? "border-red-200 bg-red-50" : message.qaResult.verdict === "WARN" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
              <p className="text-slate-700">{message.qaResult.reason}</p>
              {message.qaResult.issues.length > 0 ? (
                <ul className="mt-1 list-inside list-disc text-slate-600">
                  {message.qaResult.issues.map((iss, i) => (
                    <li key={i}>
                      <Badge tone={iss.severity === "FAIL" ? "danger" : "warning"}>{iss.severity}</Badge> {iss.note}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            {!editing ? (
              <Button variant="secondary" disabled={busy} onClick={startEdit}>
                <Pencil size={14} /> Edit
              </Button>
            ) : null}
            <Button variant="secondary" disabled={busy} onClick={() => run(() => api.post(`/projects/${projectId}/messages/${message.id}/qa`), "QA check complete.")}>
              <RefreshCw size={14} /> Re-run QA
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => run(() => api.post(`/projects/${projectId}/messages/${message.id}/regenerate`), "Email regenerated.")}>
              <RotateCw size={14} /> Regenerate
            </Button>
            <Button
              disabled={busy || (message.qaStatus !== "PASS" && message.qaStatus !== "WARN") || message.reviewStatus === "APPROVED"}
              onClick={() => run(() => api.post(`/projects/${projectId}/messages/${message.id}/approve`), "Email approved.")}
            >
              <Check size={14} /> Approve
            </Button>
            <Button
              variant="danger"
              disabled={busy || message.reviewStatus === "REJECTED"}
              onClick={() => run(() => api.post(`/projects/${projectId}/messages/${message.id}/reject`, {}), "Email rejected.")}
            >
              <X size={14} /> Reject
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
