"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import type { ProjectSummary } from "@prospect/shared";
import { api, ApiError } from "../../../lib/api";
import { PageHeader } from "../../../components/layout/page-header";
import { Card, CardBody } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";

export default function CampaignsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ProjectSummary[]>("/projects")
      .then(setProjects)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load projects"));
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader title="Campaigns" description="Campaigns are scoped to a project. Pick a project to manage its campaigns." />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!projects && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {projects && projects.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-sm text-slate-400">No projects yet — create one first.</CardBody>
        </Card>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}/campaigns`}>
            <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">
              <CardBody className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <Megaphone size={16} strokeWidth={2} />
                  </div>
                  <h3 className="truncate font-medium text-slate-900">{p.name}</h3>
                </div>
                <div className="text-xs text-slate-500">
                  {p.counts.qualified} qualified · <Badge tone="neutral">{p.status}</Badge>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
