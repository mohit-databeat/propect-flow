"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Plus, Megaphone } from "lucide-react";
import type { CampaignSummaryDto } from "@prospect/shared";
import { api, ApiError } from "../../../../../lib/api";
import { PageHeader } from "../../../../../components/layout/page-header";
import { Card, CardBody } from "../../../../../components/ui/card";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { useToast } from "../../../../../components/ui/toast";

const statusTone = { DRAFT: "neutral", ACTIVE: "info", PAUSED: "warning", COMPLETED: "success" } as const;

export default function CampaignsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const toast = useToast();

  const [campaigns, setCampaigns] = useState<CampaignSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    api
      .get<CampaignSummaryDto[]>(`/projects/${projectId}/campaigns`)
      .then(setCampaigns)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load campaigns"));
  };

  useEffect(load, [projectId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/campaigns`, { name: name.trim() });
      toast.success(`Campaign "${name.trim()}" created.`);
      setName("");
      setShowForm(false);
      load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to create campaign";
      setError(message);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Campaigns"
        description="Send approved, QA-passed emails via the simulated outbound provider — everything here is SIMULATED, no real email leaves the system."
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus size={16} /> New campaign
          </Button>
        }
      />

      {showForm ? (
        <Card>
          <CardBody>
            <form onSubmit={create} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-slate-500">Campaign name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Q1 Outreach"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!campaigns && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {campaigns && campaigns.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-sm text-slate-400">No campaigns yet. Create one to start sending approved emails.</CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {campaigns?.map((c) => (
          <Link key={c.id} href={`/projects/${projectId}/campaigns/${c.id}`}>
            <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <Megaphone size={16} strokeWidth={2} />
                    </div>
                    <h3 className="truncate font-medium text-slate-900">{c.name}</h3>
                  </div>
                  <Badge tone={statusTone[c.status]}>{c.status}</Badge>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center text-xs text-slate-500">
                  <div>
                    <div className="text-base font-semibold text-slate-900">{c.counts.total}</div>
                    total
                  </div>
                  <div>
                    <div className="text-base font-semibold text-emerald-600">{c.counts.sent}</div>
                    sent
                  </div>
                  <div>
                    <div className="text-base font-semibold text-amber-600">{c.counts.skipped}</div>
                    skipped
                  </div>
                  <div>
                    <div className="text-base font-semibold text-red-600">{c.counts.failed}</div>
                    failed
                  </div>
                </div>
                <p className="text-xs text-slate-400">Provider: {c.outboundProviderKey} · created {new Date(c.createdAt).toLocaleDateString()}</p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
