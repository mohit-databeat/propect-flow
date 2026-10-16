"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Mail, RotateCw, RefreshCw, Pencil, Check, X } from "lucide-react";
import type { MessageDto, MessageListResponse } from "@prospect/shared";
import { api, ApiError } from "../../../../../lib/api";
import { PageHeader } from "../../../../../components/layout/page-header";
import { Card, CardBody } from "../../../../../components/ui/card";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { Textarea } from "../../../../../components/ui/textarea";
import { useToast } from "../../../../../components/ui/toast";

const qaTone = { PENDING: "neutral", PASS: "success", WARN: "warning", FAIL: "danger" } as const;
const reviewTone = { PENDING: "neutral", APPROVED: "success", REJECTED: "danger", EDITED: "info" } as const;

const REVIEW_FILTERS = ["All", "PENDING", "EDITED", "APPROVED", "REJECTED"] as const;

const ACTION_SUCCESS_MESSAGE: Record<string, string> = {
  approve: "Email approved.",
  reject: "Email rejected.",
  qa: "QA check complete.",
  regenerate: "Email regenerated.",
};

export default function EmailsPage() {
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof REVIEW_FILTERS)[number]>("PENDING");
  const [data, setData] = useState<MessageListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ subject: string; body: string } | null>(null);

  const load = () => {
    const qs = filter === "All" ? "" : `?reviewStatus=${filter}`;
    api
      .get<MessageListResponse>(`/projects/${params.id}/messages${qs}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load emails"));
  };

  useEffect(load, [params.id, filter]);

  const action = async (id: string, path: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.post(`/projects/${params.id}/messages/${id}/${path}`, {});
      load();
      toast.success(ACTION_SUCCESS_MESSAGE[path] ?? "Action complete.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Action failed";
      setError(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (m: MessageDto) => {
    setEditingId(m.id);
    setEditDraft({ subject: m.subject, body: m.body });
  };

  const saveEdit = async (id: string) => {
    if (!editDraft) return;
    setBusyId(id);
    setError(null);
    try {
      await api.patch(`/projects/${params.id}/messages/${id}`, editDraft);
      setEditingId(null);
      setEditDraft(null);
      load();
      toast.success("Edit saved — QA will need to re-run.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to save edit";
      setError(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Email Review" description="Review, edit and approve AI-drafted outreach before it can be sent." />

      <div className="flex gap-1 border-b border-slate-200">
        {REVIEW_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${filter === f ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {f}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {data && data.items.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-sm text-slate-400">No emails match this filter.</CardBody>
        </Card>
      ) : null}

      <div className="space-y-3">
        {data?.items.map((m: MessageDto) => (
          <Card key={m.id}>
            <CardBody className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/projects/${params.id}/prospects/${m.prospectId ?? ""}`} className="flex items-center gap-2 text-sm font-medium text-slate-900 hover:text-brand-700">
                  <Mail size={14} /> {m.companyName} — {m.recipientName ?? "unknown recipient"}
                </Link>
                <div className="flex items-center gap-1.5">
                  <Badge tone={qaTone[m.qaStatus]}>QA: {m.qaStatus}</Badge>
                  <Badge tone={reviewTone[m.reviewStatus]}>{m.reviewStatus}</Badge>
                </div>
              </div>
              {editingId === m.id && editDraft ? (
                <div className="space-y-2">
                  <input
                    value={editDraft.subject}
                    onChange={(e) => setEditDraft({ ...editDraft, subject: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <Textarea rows={6} value={editDraft.body} onChange={(e) => setEditDraft({ ...editDraft, body: e.target.value })} />
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-1 text-sm font-medium text-slate-900">{m.subject}</div>
                  <p className="line-clamp-3 whitespace-pre-wrap text-xs text-slate-600">{m.body}</p>
                </div>
              )}
              {m.reviewNote ? <p className="text-xs text-red-600">Note: {m.reviewNote}</p> : null}
              <div className="flex flex-wrap gap-2">
                {editingId === m.id ? (
                  <>
                    <Button disabled={busyId === m.id} onClick={() => saveEdit(m.id)}>
                      <Check size={14} /> Save (resets QA)
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingId(null);
                        setEditDraft(null);
                      }}
                    >
                      <X size={14} /> Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      disabled={busyId === m.id || (m.qaStatus !== "PASS" && m.qaStatus !== "WARN") || m.reviewStatus === "APPROVED"}
                      onClick={() => action(m.id, "approve")}
                    >
                      Approve
                    </Button>
                    <Button variant="danger" disabled={busyId === m.id || m.reviewStatus === "REJECTED"} onClick={() => action(m.id, "reject")}>
                      Reject
                    </Button>
                    <Button variant="secondary" disabled={busyId === m.id} onClick={() => startEdit(m)}>
                      <Pencil size={14} /> Edit
                    </Button>
                    <Button variant="secondary" disabled={busyId === m.id} onClick={() => action(m.id, "qa")}>
                      <RefreshCw size={14} className={busyId === m.id ? "animate-spin" : ""} /> Run QA
                    </Button>
                    <Button variant="secondary" disabled={busyId === m.id} onClick={() => action(m.id, "regenerate")}>
                      <RotateCw size={14} className={busyId === m.id ? "animate-spin" : ""} /> Regenerate
                    </Button>
                    <Link href={`/projects/${params.id}/prospects/${m.prospectId ?? ""}`}>
                      <Button variant="secondary">Open prospect</Button>
                    </Link>
                  </>
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
