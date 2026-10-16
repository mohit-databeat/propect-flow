"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Send, UserPlus, RefreshCw, X, Trash2 } from "lucide-react";
import type { CampaignAddReport, CampaignClearReport, CampaignDetailDto, CampaignSendReport } from "@prospect/shared";
import { api, ApiError } from "../../../../../../lib/api";
import { PageHeader } from "../../../../../../components/layout/page-header";
import { Card, CardBody } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import { useToast } from "../../../../../../components/ui/toast";

const statusTone = { DRAFT: "neutral", ACTIVE: "info", PAUSED: "warning", COMPLETED: "success" } as const;
const qaTone = { PENDING: "neutral", PASS: "success", WARN: "warning", FAIL: "danger" } as const;
const reviewTone = { PENDING: "neutral", APPROVED: "success", REJECTED: "danger", EDITED: "info" } as const;
const sendTone = { NOT_SENT: "neutral", QUEUED: "info", SENT_SIMULATED: "success", SENT: "success", FAILED: "danger" } as const;

export default function CampaignDetailPage() {
  const params = useParams<{ id: string; campaignId: string }>();
  const toast = useToast();
  const [detail, setDetail] = useState<CampaignDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"add" | "send" | "clear" | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addReport, setAddReport] = useState<CampaignAddReport | null>(null);
  const [sendReport, setSendReport] = useState<CampaignSendReport | null>(null);
  const [clearReport, setClearReport] = useState<CampaignClearReport | null>(null);

  const load = () => {
    api
      .get<CampaignDetailDto>(`/projects/${params.id}/campaigns/${params.campaignId}`)
      .then(setDetail)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load campaign"));
  };

  useEffect(load, [params.id, params.campaignId]);

  const addMessages = async () => {
    setBusy("add");
    setError(null);
    try {
      const report = await api.post<CampaignAddReport>(`/projects/${params.id}/campaigns/${params.campaignId}/messages`, {});
      setAddReport(report);
      load();
      toast.success(`Added ${report.added} message(s) to the campaign.`);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to add messages";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy("send");
    setError(null);
    try {
      const report = await api.post<CampaignSendReport>(`/projects/${params.id}/campaigns/${params.campaignId}/send`);
      setSendReport(report);
      load();
      toast.success(`Campaign sent (simulated): ${report.sent} sent, ${report.skipped} skipped, ${report.failed} failed.`);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to send campaign";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const removeMessage = async (messageId: string, companyName: string) => {
    setRemovingId(messageId);
    setError(null);
    try {
      const updated = await api.delete<CampaignDetailDto>(`/projects/${params.id}/campaigns/${params.campaignId}/messages/${messageId}`);
      setDetail(updated);
      toast.success(`Removed ${companyName}'s email from the campaign.`);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : `Failed to remove ${companyName}'s email from the campaign`;
      setError(message);
      toast.error(message);
    } finally {
      setRemovingId(null);
    }
  };

  const clearAll = async () => {
    if (!window.confirm("Remove every not-yet-sent email from this campaign? Already-sent emails are kept.")) return;
    setBusy("clear");
    setError(null);
    try {
      const report = await api.delete<CampaignClearReport>(`/projects/${params.id}/campaigns/${params.campaignId}/messages`);
      setClearReport(report);
      load();
      toast.success(`Removed ${report.removed} email(s) from the campaign.`);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to clear campaign";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const refreshReport = async () => {
    try {
      const report = await api.get<CampaignSendReport>(`/projects/${params.id}/campaigns/${params.campaignId}/send-report`);
      setSendReport(report);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to refresh send report";
      console.warn(message, e);
      toast.error(message);
    }
  };

  if (error && !detail) return <p className="text-sm text-red-600">{error}</p>;
  if (!detail) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-4">
      <PageHeader
        title={detail.name}
        description="Simulated outbound only — no real email is ever delivered by this platform."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={statusTone[detail.status]}>{detail.status}</Badge>
            <Button variant="secondary" disabled={busy !== null} onClick={addMessages}>
              <UserPlus size={14} /> {busy === "add" ? "Adding…" : "Add approved messages"}
            </Button>
            <Button disabled={busy !== null} onClick={send}>
              <Send size={14} /> {busy === "send" ? "Sending…" : "Send campaign"}
            </Button>
            <Button variant="danger" disabled={busy !== null || detail.messages.length === 0} onClick={clearAll}>
              <Trash2 size={14} /> {busy === "clear" ? "Clearing…" : "Clear all"}
            </Button>
            <Button variant="ghost" onClick={refreshReport}>
              <RefreshCw size={14} /> Refresh report
            </Button>
          </div>
        }
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={detail.counts.total} />
        <StatCard label="Approved" value={detail.counts.approved} />
        <StatCard label="Sent (simulated)" value={detail.counts.sent} tone="text-emerald-600" />
        <StatCard label="Skipped / Failed" value={detail.counts.skipped + detail.counts.failed} tone="text-amber-600" />
      </div>

      {addReport ? (
        <Card>
          <CardBody className="space-y-2 text-sm">
            <p className="font-medium text-slate-800">
              Added {addReport.added} message(s){addReport.alreadyInCampaign > 0 ? `, ${addReport.alreadyInCampaign} already in a campaign` : ""}
              {addReport.skipped > 0 ? `, ${addReport.skipped} skipped` : ""}.
            </p>
            {addReport.skippedMessages.map((s) => (
              <div key={s.messageId} className="text-xs text-slate-500">
                {s.companyName}: {s.reason}
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {clearReport ? (
        <Card>
          <CardBody className="text-sm text-slate-700">
            Removed {clearReport.removed} email(s) from this campaign
            {clearReport.kept > 0 ? ` — ${clearReport.kept} already-sent email(s) were kept (send history can't be removed)` : ""}.
          </CardBody>
        </Card>
      ) : null}

      {sendReport ? (
        <Card>
          <CardBody className="space-y-2 text-sm">
            <p className="font-medium text-slate-800">
              Send report: {sendReport.sent} sent <Badge tone="success">SIMULATED</Badge>, {sendReport.skipped} skipped, {sendReport.failed} failed, out of {sendReport.total} total.
            </p>
            {sendReport.skippedMessages.length > 0 ? (
              <div className="space-y-1">
                {sendReport.skippedMessages.map((s) => (
                  <div key={s.messageId} className="text-xs text-slate-500">
                    {s.companyName}: {s.reason}
                  </div>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-2">Company</th>
                <th className="px-4 py-2">Recipient</th>
                <th className="px-4 py-2">Subject</th>
                <th className="px-4 py-2">QA</th>
                <th className="px-4 py-2">Review</th>
                <th className="px-4 py-2">Send status</th>
                <th className="px-4 py-2">Notes</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {detail.messages.map((m) => {
                const sent = m.sendStatus === "SENT" || m.sendStatus === "SENT_SIMULATED";
                return (
                  <tr key={m.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">{m.companyName}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {m.recipientName ?? "—"}
                      <div className="text-xs text-slate-400">{m.toAddress}</div>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-600">{m.subject}</td>
                    <td className="px-4 py-3">
                      <Badge tone={qaTone[m.qaStatus]}>{m.qaStatus}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={reviewTone[m.reviewStatus]}>{m.reviewStatus}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={sendTone[m.sendStatus]}>{m.sendStatus === "SENT_SIMULATED" ? "SIMULATED" : m.sendStatus}</Badge>
                      {m.sentAt ? <div className="mt-0.5 text-[10px] text-slate-400">{new Date(m.sentAt).toLocaleString()}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-red-600">{m.sendError ?? ""}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        disabled={sent || removingId === m.id}
                        onClick={() => removeMessage(m.id, m.companyName)}
                        title={sent ? "Already sent — can't remove from the campaign's send history" : "Remove from this campaign"}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {detail.messages.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">
                    No messages in this campaign yet. Use "Add approved messages" to pull in every currently-eligible email.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <CardBody>
        <div className={`text-xl font-semibold ${tone ?? "text-slate-900"}`}>{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </CardBody>
    </Card>
  );
}
