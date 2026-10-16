"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { ProjectAnalyticsOverview } from "@prospect/shared";
import { api, ApiError } from "../../../../../lib/api";
import { PageHeader } from "../../../../../components/layout/page-header";
import { Card, CardBody, CardHeader } from "../../../../../components/ui/card";
import { Badge } from "../../../../../components/ui/badge";

function Bar({ label, count, max, tone = "bg-brand-500" }: { label: string; count: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>{label}</span>
        <span className="font-medium text-slate-800">{count}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardBody>
        <div className="text-2xl font-semibold text-slate-900">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
        {sub ? <div className="mt-1 text-[10px] text-slate-400">{sub}</div> : null}
      </CardBody>
    </Card>
  );
}

export default function ProjectAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<ProjectAnalyticsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ProjectAnalyticsOverview>(`/projects/${params.id}/analytics/overview`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load analytics"));
  }, [params.id]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;

  const funnelMax = Math.max(1, ...data.funnel.stages.map((s) => s.count));
  const scoreMax = Math.max(1, ...data.scoreDistribution.map((b) => b.count));
  const coverageMax = Math.max(1, ...data.coverageDistribution.map((b) => b.count));

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Computed live from this project's own data — nothing here is simulated or estimated." />

      {data.companies === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-sm text-slate-400">No data yet. Add companies and run the workflow to see analytics here.</CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Companies" value={data.companies} />
            <Kpi label="Qualified" value={data.qualification.qualified} />
            <Kpi label="Needs Review" value={data.qualification.needsReview} />
            <Kpi label="Emails sent (simulated)" value={data.sentSimulated} />
            <Kpi label="Approval rate" value={data.approvalRate === null ? "—" : `${Math.round(data.approvalRate * 100)}%`} sub={data.approvalRate === null ? "No decisions yet" : undefined} />
            <Kpi label="QA pass/warn" value={data.emailQa.pass + data.emailQa.warn} sub={`of ${data.emailQa.pending + data.emailQa.pass + data.emailQa.warn + data.emailQa.fail} generated`} />
          </div>

          <Card>
            <CardHeader className="text-sm font-medium text-slate-700">Funnel: Companies → Qualified → Needs Review → Emails Generated → QA Passed/Warned → Human Approved → Sent</CardHeader>
            <CardBody className="space-y-3">
              {data.funnel.stages.map((s) => (
                <Bar key={s.key} label={s.label} count={s.count} max={funnelMax} />
              ))}
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">Qualification breakdown</CardHeader>
              <CardBody className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                <div>
                  <div className="text-lg font-semibold text-emerald-600">{data.qualification.qualified}</div>
                  <div className="text-xs text-slate-500">Qualified</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-amber-600">{data.qualification.needsReview}</div>
                  <div className="text-xs text-slate-500">Needs Review</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-red-600">{data.qualification.disqualified}</div>
                  <div className="text-xs text-slate-500">Disqualified</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-500">{data.qualification.pending}</div>
                  <div className="text-xs text-slate-500">Pending</div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">Email QA / review</CardHeader>
              <CardBody className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <Badge tone="success">{data.emailQa.pass}</Badge>
                  <div className="mt-1 text-slate-500">QA PASS</div>
                </div>
                <div>
                  <Badge tone="warning">{data.emailQa.warn}</Badge>
                  <div className="mt-1 text-slate-500">QA WARN</div>
                </div>
                <div>
                  <Badge tone="danger">{data.emailQa.fail}</Badge>
                  <div className="mt-1 text-slate-500">QA FAIL</div>
                </div>
                <div>
                  <Badge tone="success">{data.review.approved}</Badge>
                  <div className="mt-1 text-slate-500">Approved</div>
                </div>
                <div>
                  <Badge tone="danger">{data.review.rejected}</Badge>
                  <div className="mt-1 text-slate-500">Rejected</div>
                </div>
                <div>
                  <Badge tone="neutral">{data.review.pending}</Badge>
                  <div className="mt-1 text-slate-500">Pending</div>
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">Score distribution</CardHeader>
              <CardBody className="space-y-2">
                {data.scoreDistribution.map((b) => (
                  <Bar key={b.bucket} label={b.bucket} count={b.count} max={scoreMax} tone="bg-emerald-500" />
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">Coverage distribution</CardHeader>
              <CardBody className="space-y-2">
                {data.coverageDistribution.map((b) => (
                  <Bar key={b.bucket} label={b.bucket} count={b.count} max={coverageMax} tone="bg-blue-500" />
                ))}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader className="text-sm font-medium text-slate-700">Criterion breakdown (latest verdict per prospect)</CardHeader>
            <CardBody className="space-y-2">
              {data.criteria.length === 0 ? <p className="text-sm text-slate-400">No qualification results yet.</p> : null}
              {data.criteria.map((c) => {
                const total = c.pass + c.fail + c.unknown;
                return (
                  <div key={c.criterionId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>{c.label}</span>
                      <span>
                        <Badge tone="success">{c.pass} pass</Badge> <Badge tone="danger">{c.fail} fail</Badge> <Badge tone="neutral">{c.unknown} unknown</Badge>
                      </span>
                    </div>
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      {total > 0 ? (
                        <>
                          <div className="h-full bg-emerald-500" style={{ width: `${(c.pass / total) * 100}%` }} />
                          <div className="h-full bg-red-500" style={{ width: `${(c.fail / total) * 100}%` }} />
                          <div className="h-full bg-slate-300" style={{ width: `${(c.unknown / total) * 100}%` }} />
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">AI usage</CardHeader>
              <CardBody className="overflow-x-auto p-0">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="px-4 py-2">Purpose</th>
                      <th className="px-4 py-2">Provider / Model</th>
                      <th className="px-4 py-2">Calls</th>
                      <th className="px-4 py-2">Tokens (in/out)</th>
                      <th className="px-4 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.aiUsage.map((u, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="px-4 py-2 text-slate-700">{u.purpose.replaceAll("_", " ")}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {u.providerKey === "cache" ? <Badge tone="info">cache hits</Badge> : `${u.providerKey} / ${u.model}`}
                        </td>
                        <td className="px-4 py-2">{u.calls}</td>
                        <td className="px-4 py-2 text-slate-500">
                          {u.inputTokens}/{u.outputTokens}
                        </td>
                        <td className="px-4 py-2 text-slate-500">{u.costUsd !== null ? `$${u.costUsd.toFixed(4)}` : "—"}</td>
                      </tr>
                    ))}
                    {data.aiUsage.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">
                          No AI calls yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">Enrichment usage</CardHeader>
              <CardBody className="overflow-x-auto p-0">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="px-4 py-2">Provider</th>
                      <th className="px-4 py-2">Calls</th>
                      <th className="px-4 py-2">Requested</th>
                      <th className="px-4 py-2">Supplied</th>
                      <th className="px-4 py-2">Unavailable</th>
                      <th className="px-4 py-2">Cost units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.enrichmentUsage.map((u) => (
                      <tr key={u.providerKey} className="border-b border-slate-100">
                        <td className="px-4 py-2 text-slate-700">{u.providerKey}</td>
                        <td className="px-4 py-2">{u.calls}</td>
                        <td className="px-4 py-2 text-slate-500">{u.fieldsRequested}</td>
                        <td className="px-4 py-2 text-emerald-600">{u.fieldsSupplied}</td>
                        <td className="px-4 py-2 text-amber-600">{u.fieldsUnavailable}</td>
                        <td className="px-4 py-2 text-slate-500">{u.costUnits}</td>
                      </tr>
                    ))}
                    {data.enrichmentUsage.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">
                          No enrichment calls yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
