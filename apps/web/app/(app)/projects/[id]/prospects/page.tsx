"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ProspectListResponse } from "@prospect/shared";
import { api, ApiError } from "../../../../../lib/api";
import { PageHeader } from "../../../../../components/layout/page-header";
import { Card, CardBody } from "../../../../../components/ui/card";
import { Badge } from "../../../../../components/ui/badge";
import { Select } from "../../../../../components/ui/select";

const statusTone = { PENDING: "neutral", QUALIFIED: "success", DISQUALIFIED: "danger", NEEDS_REVIEW: "warning" } as const;

function CompanyAvatar({ name }: { name: string }) {
  const letter = name.trim()[0]?.toUpperCase() ?? "?";
  return <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-xs font-semibold text-brand-700">{letter}</div>;
}

function CountCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <CardBody>
        <div className={`text-xl font-semibold ${tone ?? "text-slate-900"}`}>{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </CardBody>
    </Card>
  );
}

function ScoreCell({ score, coverage }: { score: number | null; coverage: number | null }) {
  if (score === null) {
    return (
      <div className="text-xs text-slate-400" title="Insufficient evidence to compute a score">
        — <span className="italic">insufficient evidence</span>
      </div>
    );
  }
  return (
    <div>
      <div className="text-sm font-medium text-slate-800">{score}/100</div>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-brand-500" style={{ width: `${score}%` }} />
      </div>
      <div className="mt-0.5 text-[10px] text-slate-400">coverage {coverage ?? 0}%</div>
    </div>
  );
}

export default function ProspectsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [data, setData] = useState<ProspectListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState("");
  const [sort, setSort] = useState("score:desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const params2 = new URLSearchParams();
    if (status) params2.set("status", status);
    if (q) params2.set("q", q);
    if (minScore) params2.set("minScore", minScore);
    params2.set("sort", sort);
    params2.set("page", String(page));
    params2.set("pageSize", "25");

    api
      .get<ProspectListResponse>(`/projects/${projectId}/prospects?${params2.toString()}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load prospects"));
  }, [projectId, status, q, minScore, sort, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <PageHeader title="Prospect list" description={data?.runId ? `Showing results for the latest workflow run.` : "No workflow run yet — go to Workflow to run qualification."} />

      {data?.runId ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CountCard label="Total" value={data.statusCounts.total} />
          <CountCard label="Qualified" value={data.statusCounts.qualified} tone="text-emerald-600" />
          <CountCard label="Needs review" value={data.statusCounts.needsReview} tone="text-amber-600" />
          <CountCard label="Disqualified" value={data.statusCounts.disqualified} tone="text-red-600" />
        </div>
      ) : null}

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Search company</label>
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name or domain…" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Status</label>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40">
              <option value="">All statuses</option>
              <option value="QUALIFIED">Qualified</option>
              <option value="NEEDS_REVIEW">Needs review</option>
              <option value="DISQUALIFIED">Disqualified</option>
              <option value="PENDING">Pending</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Min score</label>
            <input type="number" min={0} max={100} value={minScore} onChange={(e) => { setMinScore(e.target.value); setPage(1); }} className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Sort</label>
            <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-40">
              <option value="score:desc">Score (high→low)</option>
              <option value="score:asc">Score (low→high)</option>
              <option value="name:asc">Company name</option>
              <option value="status:asc">Status</option>
            </Select>
          </div>
        </CardBody>
      </Card>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-2">Company</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Score</th>
                <th className="px-4 py-2">Key criteria</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <CompanyAvatar name={p.companyName} />
                      <div>
                        <Link href={`/projects/${projectId}/prospects/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                          {p.companyName}
                        </Link>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          {p.domain}
                          {p.possibleDuplicate ? <Badge tone="warning">possible duplicate</Badge> : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone[p.status as keyof typeof statusTone] ?? "neutral"}>{p.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <ScoreCell score={p.score} coverage={p.coverage} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {p.keyResults.slice(0, 4).map((r) => (
                        <Badge key={r.criterionId} tone={r.status === "PASS" ? "success" : r.status === "FAIL" ? "danger" : "neutral"}>
                          {r.label}: {r.status}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {data?.items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                    No prospects match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {data && data.total > data.pageSize ? (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {data.page} of {totalPages} — {data.total} prospects
          </span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">
              Previous
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
