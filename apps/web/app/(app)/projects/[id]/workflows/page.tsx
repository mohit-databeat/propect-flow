"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { GitBranch, Plus, Archive } from "lucide-react";
import type { WorkflowDetailDto, WorkflowSummaryDto } from "@prospect/shared";
import { api, ApiError } from "../../../../../lib/api";
import { PageHeader } from "../../../../../components/layout/page-header";
import { Card, CardBody } from "../../../../../components/ui/card";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { Select } from "../../../../../components/ui/select";
import { useToast } from "../../../../../components/ui/toast";

export default function WorkflowsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const router = useRouter();
  const toast = useToast();

  const [workflows, setWorkflows] = useState<WorkflowSummaryDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<"EMPTY" | "DEFAULT_PROSPECTING">("DEFAULT_PROSPECTING");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    try {
      setWorkflows(await api.get<WorkflowSummaryDto[]>(`/projects/${projectId}/workflows`));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Failed to load workflows");
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      const created = await api.post<WorkflowDetailDto>(`/projects/${projectId}/workflows`, { name: name.trim(), template });
      toast.success("Workflow created.");
      router.push(`/projects/${projectId}/workflows/${created.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to create the workflow";
      setFormError(message);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  const archive = async (w: WorkflowSummaryDto) => {
    if (!window.confirm(`Archive "${w.name}"? Its versions and past runs are kept.`)) return;
    try {
      await api.delete(`/projects/${projectId}/workflows/${w.id}`);
      toast.success("Workflow archived.");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to archive the workflow");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflow Builder"
        description="Design your own prospecting flow: connect the steps, set conditions, publish a version and run it. The fixed pipeline on the Workflow tab keeps working as before."
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus size={15} /> New workflow
          </Button>
        }
      />

      {showForm ? (
        <Card>
          <CardBody>
            <form className="grid gap-4 sm:grid-cols-[1fr_260px_auto] sm:items-end" onSubmit={create}>
              <div>
                <label htmlFor="wf-name" className="mb-1 block text-sm font-medium text-slate-700">Name</label>
                <input
                  id="wf-name"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Outbound to qualified SaaS accounts"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label htmlFor="wf-template" className="mb-1 block text-sm font-medium text-slate-700">Start from</label>
                <Select id="wf-template" value={template} onChange={(e) => setTemplate(e.target.value as typeof template)}>
                  <option value="DEFAULT_PROSPECTING">Standard prospecting flow</option>
                  <option value="EMPTY">Blank canvas</option>
                </Select>
              </div>
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </form>
            {formError ? <p role="alert" className="mt-3 text-sm text-red-600">{formError}</p> : null}
          </CardBody>
        </Card>
      ) : null}

      {loadError ? (
        <p role="alert" className="text-sm text-red-600">
          {loadError}{" "}
          <button className="underline" onClick={() => void load()}>Try again</button>
        </p>
      ) : null}
      {!workflows && !loadError ? <p className="text-sm text-slate-500">Loading…</p> : null}

      {workflows?.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            <GitBranch size={28} className="text-slate-300" aria-hidden />
            <p className="text-sm text-slate-600">No workflows yet. Start from the standard flow and change what you need.</p>
            <Button onClick={() => setShowForm(true)}>
              <Plus size={15} /> New workflow
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {workflows?.map((w) => (
          <Card key={w.id}>
            <CardBody className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/projects/${projectId}/workflows/${w.id}`} className="block truncate text-base font-semibold text-slate-900 hover:text-brand-700">
                    {w.name}
                  </Link>
                  {w.description ? <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{w.description}</p> : null}
                </div>
                {w.latestVersion ? <Badge tone="success">v{w.latestVersion}</Badge> : <Badge tone="neutral">Not published</Badge>}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  {w.nodeCount} step{w.nodeCount === 1 ? "" : "s"} · updated {new Date(w.updatedAt).toLocaleString()}
                </span>
                <div className="flex gap-2">
                  <Link href={`/projects/${projectId}/workflows/${w.id}`} className="font-medium text-brand-600 hover:text-brand-700">Open</Link>
                  <button type="button" onClick={() => void archive(w)} className="flex items-center gap-1 text-slate-500 hover:text-red-600">
                    <Archive size={13} aria-hidden /> Archive
                  </button>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
