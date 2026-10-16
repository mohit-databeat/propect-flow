"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Upload, FileSpreadsheet, Plug, Check } from "lucide-react";
import type { ConnectorCatalogueEntry, DataSourceSummary, SyncResult } from "@prospect/shared";
import { api, ApiError } from "../../../../../lib/api";
import { PageHeader } from "../../../../../components/layout/page-header";
import { Card, CardBody, CardHeader } from "../../../../../components/ui/card";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { Select } from "../../../../../components/ui/select";
import { useToast } from "../../../../../components/ui/toast";

const statusTone = { DRAFT: "neutral", READY: "info", SYNCING: "warning", SYNCED: "success", ERROR: "danger", ARCHIVED: "neutral" } as const;

function connectorIcon(key: string) {
  return key === "csv" ? FileSpreadsheet : Plug;
}

export default function DataSourcesPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const toast = useToast();

  const [sources, setSources] = useState<DataSourceSummary[] | null>(null);
  const [catalogue, setCatalogue] = useState<ConnectorCatalogueEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncResults, setSyncResults] = useState<Record<string, SyncResult>>({});
  const [newApiKey, setNewApiKey] = useState("");

  const load = async () => {
    try {
      const [s, c] = await Promise.all([
        api.get<DataSourceSummary[]>(`/projects/${projectId}/data-sources`),
        api.get<ConnectorCatalogueEntry[]>("/connectors"),
      ]);
      setSources(s);
      setCatalogue(c);
      if (!newApiKey && c.find((x) => x.type === "API" && x.isMock)) setNewApiKey(c.find((x) => x.type === "API" && x.isMock)!.key);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load data sources");
    }
  };

  useEffect(() => {
    void load();

  }, [projectId]);

  const addApiSource = async () => {
    const provider = catalogue?.find((c) => c.key === newApiKey);
    if (!provider) return;
    setBusy("add");
    setError(null);
    try {
      await api.post(`/projects/${projectId}/data-sources`, { type: "API", providerKey: provider.key, name: provider.displayName, config: {} });
      await load();
      toast.success(`Added "${provider.displayName}" as a data source.`);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to add data source";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const sync = async (dsId: string) => {
    setBusy(dsId);
    setError(null);
    try {
      const result = await api.post<SyncResult>(`/projects/${projectId}/data-sources/${dsId}/sync`);
      setSyncResults((prev) => ({ ...prev, [dsId]: result }));
      await load();
      toast.success(`Sync complete: ${result.fetched} fetched, ${result.created} created.`);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Sync failed";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const archive = async (dsId: string) => {
    setBusy(dsId);
    setError(null);
    try {
      await api.delete(`/projects/${projectId}/data-sources/${dsId}`);
      await load();
      toast.success("Data source archived.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to archive data source";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const apiConnectors = catalogue?.filter((c) => c.type === "API") ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data source configuration"
        description="Connect the company data your project will qualify against. CSV and API sources are normalized into the same canonical model."
        actions={
          <Link href={`/projects/${projectId}/data-sources/csv`}>
            <Button>
              <Upload size={16} /> Upload CSV
            </Button>
          </Link>
        }
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader className="text-sm font-medium text-slate-700">Connect a data source</CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalogue?.map((c) => {
              const Icon = connectorIcon(c.key);
              const selected = c.key === newApiKey;
              return (
                <div key={c.key} className={`rounded-xl border p-4 ${selected ? "border-brand-300 bg-brand-50/50" : "border-slate-200"}`}>
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                      <Icon size={17} strokeWidth={2} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{c.displayName}</div>
                      <div className="font-mono text-xs text-slate-400">{c.key}</div>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <Badge tone={c.isMock ? "info" : "neutral"}>{c.isMock ? "Mock" : "Real"}</Badge>
                    <Badge tone={c.available ? "success" : "warning"}>{c.available ? "Available" : "Stub"}</Badge>
                    <Badge tone={c.configured ? "success" : "danger"}>{c.configured ? "Configured" : "No credentials"}</Badge>
                  </div>
                  {c.type === "API" && c.available ? (
                    <Button variant={selected ? "primary" : "secondary"} className="mt-3 w-full" disabled={busy === "add"} onClick={() => setNewApiKey(c.key)}>
                      {selected ? (
                        <>
                          <Check size={15} /> Selected
                        </>
                      ) : (
                        "Select"
                      )}
                    </Button>
                  ) : (
                    <Button variant="secondary" className="mt-3 w-full" disabled>
                      {c.type === "CSV" ? "Use “Upload CSV” above" : "Not available"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {apiConnectors.some((c) => c.available) ? (
            <div className="flex items-center gap-2 pt-2">
              <Select value={newApiKey} onChange={(e) => setNewApiKey(e.target.value)} className="max-w-xs">
                {apiConnectors.map((c) => (
                  <option key={c.key} value={c.key} disabled={!c.available}>
                    {c.displayName} {c.available ? "" : "(unavailable)"}
                  </option>
                ))}
              </Select>
              <Button disabled={busy === "add"} onClick={addApiSource}>
                {busy === "add" ? "Adding…" : "Add API source"}
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="text-sm font-medium text-slate-700">Configured sources</CardHeader>
        <CardBody className="space-y-3">
          {sources?.length === 0 ? <p className="text-sm text-slate-400">No data sources yet.</p> : null}
          {sources?.map((s) => (
            <div key={s.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-900">{s.name}</div>
                  <div className="mt-1 flex gap-1.5">
                    <Badge tone="neutral">{s.providerKey}</Badge>
                    <Badge tone={statusTone[s.status]}>{s.status}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" disabled={busy === s.id || s.status === "ARCHIVED" || s.status === "DRAFT"} onClick={() => sync(s.id)}>
                    {busy === s.id ? "Syncing…" : "Sync"}
                  </Button>
                  {s.status === "DRAFT" && s.providerKey === "csv" ? (
                    <Link href={`/projects/${projectId}/data-sources/csv?dsId=${s.id}`}>
                      <Button variant="secondary">Confirm mapping</Button>
                    </Link>
                  ) : null}
                  {s.status !== "ARCHIVED" ? (
                    <Button variant="danger" disabled={busy === s.id} onClick={() => archive(s.id)}>
                      Archive
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500">
                <div>Last synced: {s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : "never"}</div>
                <div>Records: {s.recordCount}</div>
                {s.lastError ? <div className="text-red-600">Error: {s.lastError}</div> : null}
              </div>
              {syncResults[s.id] ? (
                <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                  fetched {syncResults[s.id]!.fetched} · created {syncResults[s.id]!.created} · skipped (already synced) {syncResults[s.id]!.skipped}
                  {syncResults[s.id]!.possibleDuplicates > 0 ? ` · possible duplicates ${syncResults[s.id]!.possibleDuplicates}` : ""}
                  {syncResults[s.id]!.normalizationErrors.length > 0 ? ` · ${syncResults[s.id]!.normalizationErrors.length} normalization errors` : ""}
                  {syncResults[s.id]!.newCompanies !== undefined ? ` · ${syncResults[s.id]!.newCompanies} new compan${syncResults[s.id]!.newCompanies === 1 ? "y" : "ies"}` : ""}
                  {syncResults[s.id]!.mergedIntoExisting ? ` · ${syncResults[s.id]!.mergedIntoExisting} matched an existing company from another source (merged, not duplicated)` : ""}
                </div>
              ) : null}
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
