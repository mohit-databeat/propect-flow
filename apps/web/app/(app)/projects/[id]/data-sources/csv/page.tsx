"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { CanonicalFieldPath, DataSourceSummary, FieldMappingDto, SyncResult } from "@prospect/shared";
import { api, ApiError } from "../../../../../../lib/api";
import { API_URL } from "../../../../../../lib/config";
import { authStorage } from "../../../../../../lib/auth";
import { PageHeader } from "../../../../../../components/layout/page-header";
import { Card, CardBody, CardHeader } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import { Select } from "../../../../../../components/ui/select";
import { useToast } from "../../../../../../components/ui/toast";

const CANONICAL_FIELDS: (CanonicalFieldPath | "")[] = [
  "",
  "identity.name",
  "identity.domain",
  "firmographics.industry",
  "firmographics.subIndustry",
  "firmographics.description",
  "firmographics.country",
  "firmographics.hqCity",
  "firmographics.hqState",
  "firmographics.employeeCount",
  "firmographics.revenueUsd",
  "firmographics.foundedYear",
  "firmographics.fundingStage",
  "firmographics.totalFundingUsd",
  "technographics.stack",
];

export default function CsvUploadPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const projectId = params.id;
  const existingDsId = search.get("dsId");
  const toast = useToast();

  const [dataSourceId, setDataSourceId] = useState<string | null>(existingDsId);
  const [columns, setColumns] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<FieldMappingDto>({});
  const [mappingSource, setMappingSource] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("DRAFT");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    if (!existingDsId) return;
    api
      .get<DataSourceSummary>(`/projects/${projectId}/data-sources/${existingDsId}`)
      .then((ds) => {
        const cfg = ds.config as { columns?: string[]; mapping?: FieldMappingDto; rows?: Record<string, string>[] };
        setColumns(cfg.columns ?? []);
        setMapping(cfg.mapping ?? {});
        setSampleRows((cfg.rows ?? []).slice(0, 20));
        setStatus(ds.status);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load data source"));

  }, [existingDsId]);

  const onFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_URL}/projects/${projectId}/data-sources/csv/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authStorage.accessToken}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch((parseErr) => {
          console.warn("Failed to parse upload error response body:", parseErr);
          return { message: res.statusText };
        });
        throw new Error(body.message ?? "Upload failed");
      }
      const data = await res.json();
      setDataSourceId(data.dataSourceId);
      setColumns(data.columns);
      setSampleRows(data.sampleRows);
      setMapping(data.suggestedMapping);
      setMappingSource(data.mappingSource);
      setStatus("DRAFT");
      router.replace(`/projects/${projectId}/data-sources/csv?dsId=${data.dataSourceId}`);
      toast.success(`Uploaded ${file.name} — ${data.columns.length} column(s) detected.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const validationIssues: string[] = [];
  const targets = Object.values(mapping).filter((v): v is CanonicalFieldPath => Boolean(v));
  if (!targets.includes("identity.name")) validationIssues.push("identity.name must be mapped to a column.");
  const dupes = targets.filter((t, i) => targets.indexOf(t) !== i);
  if (dupes.length > 0) validationIssues.push(`Field mapped from more than one column: ${[...new Set(dupes)].join(", ")}`);

  const confirmMapping = async () => {
    if (!dataSourceId) return;
    setConfirming(true);
    setError(null);
    try {
      await api.put(`/projects/${projectId}/data-sources/${dataSourceId}/mapping`, { mapping });
      setStatus("READY");
      toast.success("Field mapping saved.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to save mapping";
      setError(message);
      toast.error(message);
    } finally {
      setConfirming(false);
    }
  };

  const sync = async () => {
    if (!dataSourceId) return;
    setSyncing(true);
    setError(null);
    try {
      const result = await api.post<SyncResult>(`/projects/${projectId}/data-sources/${dataSourceId}/sync`);
      setSyncResult(result);
      setStatus("SYNCED");
      toast.success(`Sync complete: ${result.fetched} fetched, ${result.created} created.`);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Sync failed";
      setError(message);
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="CSV upload & field mapping" description="Upload a CSV of companies, confirm how columns map to canonical fields, then sync." />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!dataSourceId ? (
        <Card>
          <CardBody>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 p-10 text-center hover:border-brand-400">
              <span className="text-sm font-medium text-slate-700">{uploading ? "Uploading…" : "Drop a CSV file here or click to choose"}</span>
              <span className="mt-1 text-xs text-slate-400">Headers + first 20 rows will be previewed before you confirm the mapping.</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFile(file);
                }}
              />
            </label>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Preview — {sampleRows.length} of many rows shown</span>
              <div className="flex items-center gap-2">
                {mappingSource ? <Badge tone="info">{mappingSource === "ai" ? "AI-refined suggestion" : "Heuristic suggestion"}</Badge> : null}
                <Badge tone={status === "SYNCED" ? "success" : status === "READY" ? "info" : "neutral"}>{status}</Badge>
              </div>
            </CardHeader>
            <CardBody>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr>
                      {columns.map((c) => (
                        <th key={c} className="border-b border-slate-200 px-2 py-1 text-left font-medium text-slate-600">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sampleRows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {columns.map((c) => (
                          <td key={c} className="border-b border-slate-100 px-2 py-1 text-slate-500">
                            {row[c]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="text-sm font-medium text-slate-700">Field mapping</CardHeader>
            <CardBody className="space-y-2">
              {columns.map((col) => (
                <div key={col} className="flex items-center gap-3">
                  <div className="w-48 shrink-0 truncate text-sm text-slate-700" title={col}>
                    {col}
                  </div>
                  <span className="text-slate-400">→</span>
                  <Select
                    value={mapping[col] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [col]: (e.target.value || null) as CanonicalFieldPath | null }))}
                    className="max-w-xs"
                  >
                    {CANONICAL_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {f || "(ignore)"}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}

              {validationIssues.length > 0 ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  <ul className="list-inside list-disc">
                    {validationIssues.map((v, i) => (
                      <li key={i}>{v}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex justify-end gap-2 pt-2">
                <Button disabled={validationIssues.length > 0 || confirming} onClick={confirmMapping}>
                  {confirming ? "Saving…" : "Confirm mapping"}
                </Button>
                <Button variant="secondary" disabled={status === "DRAFT" || syncing} onClick={sync}>
                  {syncing ? "Syncing…" : "Sync"}
                </Button>
              </div>
            </CardBody>
          </Card>

          {syncResult ? (
            <Card>
              <CardHeader className="text-sm font-medium text-slate-700">Sync results</CardHeader>
              <CardBody className="space-y-2 text-sm text-slate-600">
                <div>
                  Fetched {syncResult.fetched} · Created {syncResult.created} · Skipped (already synced) {syncResult.skipped}
                  {syncResult.possibleDuplicates > 0 ? ` · Possible duplicates ${syncResult.possibleDuplicates}` : ""}
                </div>
                {syncResult.normalizationErrors.length > 0 ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    <p className="font-medium">Rejected rows:</p>
                    <ul className="list-inside list-disc">
                      {syncResult.normalizationErrors.map((e, i) => (
                        <li key={i}>
                          {e.externalId ?? "row"}: {e.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
