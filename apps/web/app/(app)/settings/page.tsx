"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SettingsResponse, WorkspaceMemberResponse, WorkspaceResponse } from "@prospect/shared";
import { api, ApiError } from "../../../lib/api";
import { PageHeader } from "../../../components/layout/page-header";
import { Card, CardBody, CardHeader } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import { useToast } from "../../../components/ui/toast";

const roleTone = { OWNER: "info", ADMIN: "neutral", MEMBER: "neutral" } as const;

export default function SettingsPage() {
  const toast = useToast();
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberResponse[] | null>(null);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const load = () => {
    api
      .get<WorkspaceResponse>("/workspaces/current")
      .then((ws) => {
        setWorkspace(ws);
        setName(ws.name);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load workspace"));
    api
      .get<WorkspaceMemberResponse[]>("/workspaces/current/members")
      .then(setMembers)
      .catch((e) => console.warn("Failed to load workspace members:", e));
    api
      .get<SettingsResponse>("/settings")
      .then(setSettings)
      .catch((e) => console.warn("Failed to load settings:", e));
  };

  useEffect(load, []);

  const selectProvider = async (settingKey: "aiProviderKey" | "enrichmentProviderKey" | "outboundProviderKey", providerKey: string) => {
    setSwitching(settingKey);
    setProviderError(null);
    try {
      const updated = await api.patch<WorkspaceResponse>("/workspaces/current", { settings: { [settingKey]: providerKey } });
      setWorkspace(updated);
      const fresh = await api.get<SettingsResponse>("/settings");
      setSettings(fresh);
      toast.success("Provider updated.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to switch provider";
      setProviderError(message);
      toast.error(message);
    } finally {
      setSwitching(null);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await api.patch<WorkspaceResponse>("/workspaces/current", { name });
      setWorkspace(updated);
      setSaved(true);
      toast.success("Workspace name saved.");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to save";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" description="Manage your workspace, team, and provider configuration." />
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="text-sm font-medium text-slate-700">Workspace</CardHeader>
            <CardBody>
              {workspace ? (
                <form className="space-y-4" onSubmit={save}>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Workspace name</label>
                    <input
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setSaved(false);
                      }}
                      className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Slug</label>
                    <input disabled value={workspace.slug} className="w-full max-w-sm rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Button type="submit" disabled={saving || name === workspace.name}>
                      {saving ? "Saving…" : "Save changes"}
                    </Button>
                    {saved ? <span className="text-xs text-emerald-600">Saved</span> : null}
                  </div>
                </form>
              ) : (
                <p className="text-sm text-slate-500">Loading…</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="text-sm font-medium text-slate-700">Team members</CardHeader>
            <CardBody className="space-y-2">
              {!members ? <p className="text-sm text-slate-500">Loading…</p> : null}
              {members?.map((m) => (
                <div key={m.userId} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5">
                  <div>
                    <div className="text-sm font-medium text-slate-800">{m.name}</div>
                    <div className="text-xs text-slate-400">{m.email}</div>
                  </div>
                  <Badge tone={roleTone[m.role]}>{m.role}</Badge>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="h-fit">
            <CardHeader className="text-sm font-medium text-slate-700">Attribute source precedence</CardHeader>
            <CardBody className="space-y-2 text-sm">
              {workspace ? (
                <div className="flex flex-wrap gap-1.5">
                  {workspace.settings.sourcePrecedence.map((p, i) => (
                    <Badge key={p} tone="neutral">
                      {i + 1}. {p}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500">Loading…</p>
              )}
            </CardBody>
          </Card>

          <Card className="h-fit">
            <CardHeader className="text-sm font-medium text-slate-700">Effective AI models by purpose</CardHeader>
            <CardBody className="space-y-2 text-sm">
              {!settings ? <p className="text-slate-500">Loading…</p> : null}
              {settings?.effectiveModels.map((m) => (
                <div key={m.purpose} className="rounded-lg border border-slate-100 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium text-slate-800">{m.purpose.replaceAll("_", " ")}</span>
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{m.effective}</code>
                  </div>
                  <p className="text-xs text-slate-400">{m.configuredOverride ? `Override: AI_MODEL_${m.purpose}=${m.configuredOverride}` : `Provider default (${m.providerDefault})`}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ProviderCatalogueCard
          title="AI providers"
          entries={settings?.catalogue.ai}
          selected={settings?.selected.aiProviderKey}
          onSelect={(key) => selectProvider("aiProviderKey", key)}
          busy={switching === "aiProviderKey"}
        />
        <ProviderCatalogueCard title="Data connectors" entries={settings?.catalogue.connectors} />
        <ProviderCatalogueCard
          title="Enrichment providers"
          entries={settings?.catalogue.enrichment}
          selected={settings?.selected.enrichmentProviderKey}
          onSelect={(key) => selectProvider("enrichmentProviderKey", key)}
          busy={switching === "enrichmentProviderKey"}
        />
        <ProviderCatalogueCard
          title="Outbound providers"
          entries={settings?.catalogue.outbound}
          selected={settings?.selected.outboundProviderKey}
          onSelect={(key) => selectProvider("outboundProviderKey", key)}
          busy={switching === "outboundProviderKey"}
        />
      </div>
      {providerError ? <p className="mt-3 text-sm text-red-600">{providerError}</p> : null}
    </div>
  );
}

interface CatalogueRow {
  key: string;
  displayName: string;
  isMock: boolean;
  available: boolean;
  configured: boolean;
}

function ProviderCatalogueCard({
  title,
  entries,
  selected,
  onSelect,
  busy,
}: {
  title: string;
  entries: CatalogueRow[] | undefined;
  selected?: string;
  onSelect?: (key: string) => void;
  busy?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between text-sm font-medium text-slate-700">
        <span>{title}</span>
        {onSelect && entries ? (
          <Select className="w-auto max-w-[220px]" value={selected} disabled={busy} onChange={(e) => onSelect(e.target.value)}>
            {entries.map((p) => (
              <option key={p.key} value={p.key}>
                {p.displayName}
              </option>
            ))}
          </Select>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-2">
        {!entries ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {entries?.map((p) => (
          <div key={p.key} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${p.key === selected ? "border-brand-300 bg-brand-50" : "border-slate-100"}`}>
            <div>
              <div className="font-medium text-slate-800">
                {p.displayName} {p.key === selected ? <Badge tone="info">selected</Badge> : null}
              </div>
              <div className="text-xs text-slate-400">key: {p.key}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge tone={p.isMock ? "neutral" : "success"}>{p.isMock ? "mock" : "real"}</Badge>
              <Badge tone={p.available ? "success" : "danger"}>{p.available ? "available" : "unavailable"}</Badge>
              <Badge tone={p.configured ? "success" : "warning"}>{p.configured ? "configured" : "unconfigured"}</Badge>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
