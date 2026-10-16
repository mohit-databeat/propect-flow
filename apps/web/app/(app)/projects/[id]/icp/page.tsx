"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { IcpChatResponse, IcpStateResponse } from "@prospect/shared";
import { api, ApiError } from "../../../../../lib/api";
import { PageHeader } from "../../../../../components/layout/page-header";
import { Card, CardBody, CardHeader } from "../../../../../components/ui/card";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { ClarificationCard } from "../../../../../components/icp/clarification-card";
import { CriterionCard } from "../../../../../components/icp/criterion-card";
import { useToast } from "../../../../../components/ui/toast";

export default function IcpPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const toast = useToast();

  const [state, setState] = useState<IcpStateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<{ text: string; reason: string }[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [activating, setActivating] = useState(false);
  const [viewMode, setViewMode] = useState<"active" | "draft" | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const s = await api.get<IcpStateResponse>(`/projects/${projectId}/icp`);
      setState(s);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load ICP state");
    }
  };

  const defaultViewFor = (s: IcpStateResponse | null): "active" | "draft" | null => {
    if (!s) return null;
    const draftHasContent = (s.draft?.definition.criteria.length ?? 0) > 0 || (s.draft?.chatTranscript.length ?? 0) > 0;
    if (draftHasContent) return "draft";
    if (s.active) return "active";
    return s.draft ? "draft" : null;
  };

  useEffect(() => {
    void load();

  }, [projectId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state?.draft?.chatTranscript.length]);

  const sendMessage = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.post<IcpChatResponse>(`/projects/${projectId}/icp/chat`, { message: message.trim() });
      setState(res);
      setUnsupported(res.unsupported);
      setMessage("");
      setViewMode("draft");
    } catch (e) {
      const errMessage = e instanceof ApiError ? e.message : "Failed to send message";
      setError(errMessage);
      toast.error(errMessage);
    } finally {
      setSending(false);
    }
  };

  const resolveClarification = async (clarId: string, answer: string) => {
    try {
      const res = await api.post<IcpStateResponse>(`/projects/${projectId}/icp/clarifications/${clarId}/resolve`, { answer });
      setState(res);
      setError(null);
      setViewMode("draft");
      toast.success("Clarification resolved.");
    } catch (e) {
      const errMessage = e instanceof ApiError ? e.message : "Failed to resolve clarification";
      setError(errMessage);
      toast.error(errMessage);
      throw e;
    }
  };

  const updateCriterion = async (source: "draft" | "active", index: number, patch: { weight?: number; required?: boolean }) => {
    const base = source === "draft" ? state?.draft?.definition : state?.active?.definition;
    if (!base) return;
    const criteria = base.criteria.map((c, i) => (i === index ? { ...c, ...patch } : c));
    const body = { schemaVersion: base.schemaVersion, name: base.name, summary: base.summary, targetPersonas: base.targetPersonas, criteria, scoring: base.scoring };
    try {
      const res = await api.put<IcpStateResponse>(`/projects/${projectId}/icp/draft`, body);
      setState(res);
      if (source === "active") {
        setNotice("Started a new draft from the active ICP with your change applied — Activate below to make it take effect.");
        setViewMode("draft");
      }
    } catch (e) {
      const errMessage = e instanceof ApiError ? e.message : "Failed to update criterion";
      setError(errMessage);
      toast.error(errMessage);
    }
  };

  const activate = async () => {
    setActivating(true);
    setError(null);
    try {
      const res = await api.post<IcpStateResponse>(`/projects/${projectId}/icp/activate`);
      setState(res);
      setViewMode("active");
      toast.success(`ICP activated (v${res.active?.version ?? "?"}).`);
    } catch (e) {
      const errMessage = e instanceof ApiError ? e.message : "Failed to activate ICP";
      setError(errMessage);
      toast.error(errMessage);
    } finally {
      setActivating(false);
    }
  };

  if (!state && !error) {
    return (
      <div>
        <PageHeader title="Chat-based ICP setup" />
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  const draft = state?.draft;
  const active = state?.active;
  const effectiveViewMode = viewMode ?? defaultViewFor(state);

  const displayIcp =
    effectiveViewMode === "draft" && draft
      ? { name: draft.definition.name, summary: draft.definition.summary, criteria: draft.definition.criteria, source: "draft" as const }
      : effectiveViewMode === "active" && active
        ? { name: active.definition.name, summary: active.definition.summary, criteria: active.definition.criteria, source: "active" as const }
        : null;

  return (
    <div>
      <PageHeader
        title="Chat-based ICP setup"
        description="Describe your ideal customer in plain language. The assistant turns it into a structured, versioned targeting definition."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => active && setViewMode("active")} disabled={!active} className="disabled:cursor-not-allowed">
              {active ? (
                <Badge tone={effectiveViewMode === "active" ? "success" : "neutral"}>{effectiveViewMode === "active" ? "● " : ""}Active v{active.version}</Badge>
              ) : (
                <Badge tone="neutral">No active ICP</Badge>
              )}
            </button>
            {draft ? (
              <button onClick={() => setViewMode("draft")}>
                <Badge tone={effectiveViewMode === "draft" ? "info" : "neutral"}>{effectiveViewMode === "draft" ? "● " : ""}Draft v{draft.version}</Badge>
              </button>
            ) : null}
          </div>
        }
      />
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
      {notice ? (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="ml-3 shrink-0 text-blue-400 hover:text-blue-600">
            ✕
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="flex h-[70vh] flex-col">
          <CardHeader className="text-sm font-medium text-slate-700">Conversation</CardHeader>
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {(draft?.chatTranscript.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-400">
                Try: “We sell to US-based SaaS companies with 100 to 500 employees and more than $10M revenue. They should already use Salesforce. Ideally they are
                hiring salespeople right now.”
              </p>
            ) : null}
            {draft?.chatTranscript.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"}`}>
                  {m.content}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Describe your ideal customer…"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <Button disabled={sending || !message.trim()} onClick={sendMessage}>
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Structured ICP{displayIcp ? ` — ${displayIcp.name}` : ""}</span>
              {draft ? (
                <Button disabled={!state?.activatable || activating} onClick={activate}>
                  {activating ? "Activating…" : "Activate"}
                </Button>
              ) : null}
            </CardHeader>
            <CardBody className="space-y-3">
              {displayIcp?.source === "active" ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                  This is the active ICP (v{active?.version}). Changing a weight or required flag here starts a new draft from it — you'll need to hit
                  Activate afterwards for the change to take effect.
                </div>
              ) : null}

              {displayIcp?.summary ? <p className="text-sm text-slate-600">{displayIcp.summary}</p> : null}

              {displayIcp?.source === "draft" && !state?.activatable && state?.blockers.length ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-medium text-red-700">Cannot activate yet:</p>
                  <ul className="mt-1 list-inside list-disc text-xs text-red-700">
                    {state.blockers.map((b, i) => (
                      <li key={i}>{b.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {displayIcp && displayIcp.criteria.length > 0 ? (
                <div className="space-y-2">
                  {displayIcp.criteria.map((c, i) => (
                    <CriterionCard
                      key={c.id}
                      criterion={c}
                      onWeightChange={(weight) => updateCriterion(displayIcp.source, i, { weight })}
                      onRequiredChange={(required) => updateCriterion(displayIcp.source, i, { required })}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No criteria yet — keep chatting to build the ICP.</p>
              )}
            </CardBody>
          </Card>

          {state && state.unresolvedClarifications.length > 0 ? (
            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">Needs your input</CardHeader>
              <CardBody className="space-y-2">
                {state.unresolvedClarifications.map((c) => (
                  <ClarificationCard key={c.id} clarification={c} onResolve={(answer) => resolveClarification(c.id, answer)} />
                ))}
              </CardBody>
            </Card>
          ) : null}

          {state && state.defaultedAssumptions.length > 0 ? (
            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">Assumptions made for you</CardHeader>
              <CardBody className="space-y-2">
                {state.defaultedAssumptions.map((c) => (
                  <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    <span className="font-medium text-slate-700">{c.question}</span> — {c.proposedDefault}
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}

          {unsupported.length > 0 ? (
            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">Not supported by the platform</CardHeader>
              <CardBody className="space-y-2">
                {unsupported.map((u, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <div className="text-slate-700">{u.text}</div>
                    <div className="text-xs text-slate-500">{u.reason}</div>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
