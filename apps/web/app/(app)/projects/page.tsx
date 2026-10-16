"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, FolderKanban, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { api, ApiError } from "../../../lib/api";
import { PageHeader } from "../../../components/layout/page-header";
import { Card, CardBody } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { useToast } from "../../../components/ui/toast";

interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  counts: { dataSources: number; companies: number; prospects: number; qualified: number; needsReview: number; disqualified: number };
  activeIcp: { id: string; name: string; version: number } | null;
  lastRun: { id: string; status: string; startedAt: string | null; finishedAt: string | null } | null;
}

const statusTone = { DRAFT: "neutral", ACTIVE: "success", ARCHIVED: "warning" } as const;

export default function ProjectsPage() {
  const router = useRouter();
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    api
      .get<ProjectSummary[]>("/projects")
      .then(setProjects)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load projects"));
  };

  useEffect(load, []);

  const archiveProject = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.delete(`/projects/${id}`);
      load();
      toast.success("Project archived.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to archive project";
      setError(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  const unarchiveProject = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.post(`/projects/${id}/unarchive`);
      load();
      toast.success("Project unarchived.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to unarchive project";
      setError(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  const deleteProject = async (id: string, name: string) => {
    const confirmed = window.confirm(
      `Permanently delete "${name}"? This removes every company, prospect, ICP version, data source and workflow run in this project. This cannot be undone.`,
    );
    if (!confirmed) return;
    setBusyId(id);
    setError(null);
    try {
      await api.delete(`/projects/${id}/permanent`);
      load();
      toast.success(`"${name}" was permanently deleted.`);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to delete project";
      setError(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Each project pairs an ICP with data sources and a prospecting workflow."
        actions={
          <Link href="/projects/new">
            <Button>
              <Plus size={16} /> New project
            </Button>
          </Link>
        }
      />
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
      {!projects && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {projects && projects.length === 0 ? (
        <Card>
          <CardBody className="text-center text-sm text-slate-500">No projects yet. Create your first one to get started.</CardBody>
        </Card>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => (
          <Card
            key={p.id}
            className="h-full cursor-pointer transition-shadow hover:shadow-md"
            onClick={() => router.push(`/projects/${p.id}/icp`)}
          >
            <CardBody className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <FolderKanban size={16} strokeWidth={2} />
                  </div>
                  <h3 className="truncate font-medium text-slate-900">{p.name}</h3>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge tone={statusTone[p.status]}>{p.status}</Badge>
                  {p.status === "ARCHIVED" ? (
                    <button
                      title="Unarchive project"
                      disabled={busyId === p.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void unarchiveProject(p.id);
                      }}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArchiveRestore size={14} />
                    </button>
                  ) : (
                    <button
                      title="Archive project"
                      disabled={busyId === p.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void archiveProject(p.id);
                      }}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Archive size={14} />
                    </button>
                  )}
                  <button
                    title="Delete project permanently"
                    disabled={busyId === p.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteProject(p.id, p.name);
                    }}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {p.description ? <p className="line-clamp-2 text-sm text-slate-500">{p.description}</p> : null}
              <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-500">
                <div>
                  <div className="text-base font-semibold text-slate-900">{p.counts.companies}</div>
                  companies
                </div>
                <div>
                  <div className="text-base font-semibold text-emerald-600">{p.counts.qualified}</div>
                  qualified
                </div>
                <div>
                  <div className="text-base font-semibold text-amber-600">{p.counts.needsReview}</div>
                  review
                </div>
              </div>
              {p.activeIcp ? <p className="text-xs text-slate-400">ICP: {p.activeIcp.name} (v{p.activeIcp.version})</p> : <p className="text-xs text-slate-400">No active ICP yet</p>}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
