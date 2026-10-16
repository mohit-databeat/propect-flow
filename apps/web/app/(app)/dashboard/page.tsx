"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, UserCheck, Mail, Sparkles, ArrowRight } from "lucide-react";
import { api, ApiError } from "../../../lib/api";
import { PageHeader } from "../../../components/layout/page-header";
import { Card, CardBody, CardHeader } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";

interface AnalyticsOverview {
  projects: { total: number; active: number; draft: number; archived: number };
  companies: number;
  prospects: { total: number; qualified: number; needsReview: number; disqualified: number; pending: number };
  emails: { total: number; pendingReview: number; approved: number; rejected: number; edited: number; sent: number };
  ai: { runs: number; inputTokens: number; outputTokens: number; costUsd: number };
}

interface ProjectSummary {
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  counts: { companies: number; prospects: number; qualified: number };
  lastRun: { id: string; status: string; startedAt: string | null; finishedAt: string | null } | null;
}

interface MeResponse {
  user: { id: string; email: string; name: string };
}

const statusTone = { DRAFT: "neutral", ACTIVE: "success", ARCHIVED: "warning" } as const;

function timeOfDayGreeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string | number }) {
  return (
    <Card>
      <CardBody className="flex items-center gap-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon size={19} strokeWidth={2} />
        </div>
        <div>
          <div className="text-xs text-slate-500">{label}</div>
          <div className="mt-0.5 text-xl font-semibold text-slate-900">{value}</div>
        </div>
      </CardBody>
    </Card>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [greeting, setGreeting] = useState("Good morning");
  const [firstName, setFirstName] = useState<string | null>(null);

  useEffect(() => {
    setGreeting(timeOfDayGreeting(new Date().getHours()));
    api
      .get<AnalyticsOverview>("/analytics/overview")
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load dashboard data"));
    api
      .get<ProjectSummary[]>("/projects")
      .then(setProjects)
      .catch((e) => console.warn("Failed to load recent projects:", e));
    api
      .get<MeResponse>("/auth/me")
      .then((res) => setFirstName(res.user.name.trim().split(/\s+/)[0] ?? null))
      .catch((e) => console.warn("Failed to load current user:", e));
  }, []);

  return (
    <div>
      <PageHeader title={firstName ? `${greeting}, ${firstName} 👋` : `${greeting} 👋`} description="Here's what's happening across your prospecting workspace." />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}

      {data ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard icon={Building2} label="Companies processed" value={data.companies} />
          <StatCard icon={UserCheck} label="Qualified prospects" value={data.prospects.qualified} />
          <StatCard icon={Mail} label="Emails sent" value={data.emails.sent} />
          <StatCard icon={Sparkles} label="AI runs" value={data.ai.runs} />
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="text-sm font-medium text-slate-700">Prospecting activity</CardHeader>
          <CardBody>
            {data ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-slate-50 p-3 text-center">
                  <div className="text-lg font-semibold text-slate-900">{data.prospects.total}</div>
                  <div className="text-xs text-slate-500">Total prospects</div>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3 text-center">
                  <div className="text-lg font-semibold text-emerald-700">{data.prospects.qualified}</div>
                  <div className="text-xs text-emerald-600">Qualified</div>
                </div>
                <div className="rounded-lg bg-amber-50 p-3 text-center">
                  <div className="text-lg font-semibold text-amber-700">{data.prospects.needsReview}</div>
                  <div className="text-xs text-amber-600">Needs review</div>
                </div>
                <div className="rounded-lg bg-red-50 p-3 text-center">
                  <div className="text-lg font-semibold text-red-700">{data.prospects.disqualified}</div>
                  <div className="text-xs text-red-600">Disqualified</div>
                </div>
              </div>
            ) : null}
            {data ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 p-3 text-center">
                  <div className="text-base font-semibold text-slate-900">{data.emails.pendingReview}</div>
                  <div className="text-xs text-slate-500">Emails pending review</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 text-center">
                  <div className="text-base font-semibold text-slate-900">{data.emails.approved}</div>
                  <div className="text-xs text-slate-500">Emails approved</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 text-center">
                  <div className="text-base font-semibold text-slate-900">${data.ai.costUsd.toFixed(2)}</div>
                  <div className="text-xs text-slate-500">AI spend</div>
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Recent projects</span>
            <Link href="/projects" className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              View all <ArrowRight size={13} />
            </Link>
          </CardHeader>
          <CardBody className="space-y-2">
            {projects?.length === 0 ? <p className="text-sm text-slate-400">No projects yet.</p> : null}
            {projects?.slice(0, 5).map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}/icp`}
                className="flex items-center justify-between rounded-lg border border-slate-100 p-2.5 text-sm hover:bg-slate-50"
              >
                <div>
                  <div className="font-medium text-slate-800">{p.name}</div>
                  <div className="text-xs text-slate-400">
                    {p.counts.companies} companies · {p.counts.qualified} qualified
                  </div>
                </div>
                <Badge tone={statusTone[p.status]}>{p.status}</Badge>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
