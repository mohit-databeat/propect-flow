"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import type { AnalyticsOverview } from "@prospect/shared";
import { api, ApiError } from "../../../lib/api";
import { PageHeader } from "../../../components/layout/page-header";
import { Card, CardBody, CardHeader } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardBody>
        <div className="text-2xl font-semibold text-slate-900">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </CardBody>
    </Card>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AnalyticsOverview>("/analytics/overview")
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load analytics"));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Workspace-wide totals, computed live from the database. Open a project below for its full funnel and breakdowns." />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Companies" value={data.companies} />
            <Kpi label="Qualified" value={data.prospects.qualified} />
            <Kpi label="Needs Review" value={data.prospects.needsReview} />
            <Kpi label="Emails generated" value={data.emails.total} />
            <Kpi label="Approved" value={data.emails.approved} />
            <Kpi label="Sent" value={data.emails.sent} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">AI usage (workspace)</CardHeader>
              <CardBody className="space-y-1 text-sm text-slate-600">
                <div>{data.ai.runs} calls</div>
                <div>
                  {data.ai.inputTokens}/{data.ai.outputTokens} tokens (in/out)
                </div>
                <div>${data.ai.costUsd.toFixed(4)} cost</div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">Enrichment (workspace)</CardHeader>
              <CardBody className="space-y-1 text-sm text-slate-600">
                <div>{data.enrichment.runs} runs</div>
                <div className="text-emerald-600">{data.enrichment.succeeded} succeeded</div>
                <div className="text-amber-600">{data.enrichment.partial} partial</div>
                <div className="text-red-600">{data.enrichment.failed} failed</div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">Providers</CardHeader>
              <CardBody className="space-y-1 text-xs text-slate-600">
                <div>
                  AI: <Badge tone="neutral">{data.providers.ai.key}</Badge> {data.providers.ai.configured ? <Badge tone="success">configured</Badge> : <Badge tone="warning">unconfigured</Badge>}
                </div>
                <div>
                  Enrichment: <Badge tone="neutral">{data.providers.enrichment.key}</Badge>{" "}
                  {data.providers.enrichment.configured ? <Badge tone="success">configured</Badge> : <Badge tone="warning">unconfigured</Badge>}
                </div>
                <div>
                  Outbound: <Badge tone="neutral">{data.providers.outbound.key}</Badge>{" "}
                  {data.providers.outbound.configured ? <Badge tone="success">configured</Badge> : <Badge tone="warning">unconfigured</Badge>}
                </div>
              </CardBody>
            </Card>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-medium text-slate-700">Per-project analytics</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.recentRuns.length === 0 ? <p className="text-sm text-slate-400">No projects with runs yet.</p> : null}
              {[...new Map(data.recentRuns.map((r) => [r.projectId, r])).values()].map((r) => (
                <Link key={r.projectId} href={`/projects/${r.projectId}/analytics`}>
                  <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">
                    <CardBody className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                        <BarChart3 size={16} strokeWidth={2} />
                      </div>
                      <span className="font-medium text-slate-900">{r.projectName}</span>
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
