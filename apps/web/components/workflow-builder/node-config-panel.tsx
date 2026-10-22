"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import {
  CONDITION_FIELDS,
  CONDITION_FIELD_RULES,
  NODE_CATALOG,
  NODE_CONFIG_SCHEMAS,
  type CampaignSummaryDto,
  type ConditionField,
  type ConditionOperator,
  type DataSourceSummary,
  type ValidationIssue,
  type WorkflowDraftDefinition,
} from "@prospect/shared";
import { api, ApiError } from "../../lib/api";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { NODE_VISUALS } from "./node-visuals";

type DraftNode = WorkflowDraftDefinition["nodes"][number];

interface Props {
  projectId: string;
  node: DraftNode;
  onRename: (label: string) => void;
  onConfig: (config: Record<string, unknown>) => void;
  onRemove: () => void;
  onClose: () => void;
  issues: readonly ValidationIssue[];
}

const operatorLabel: Record<ConditionOperator, string> = {
  EQ: "is",
  NEQ: "is not",
  IN: "is any of",
  GTE: "is at least",
  LTE: "is at most",
  IS_TRUE: "is true",
  IS_FALSE: "is false",
};

const fieldLabel: Record<ConditionField, string> = {
  status: "Qualification status",
  score: "Score",
  coverage: "Coverage",
  hasMissingFields: "Has missing fields",
  hasRequiredFail: "Failed a required criterion",
  qaStatus: "Email QA result",
};

function defaultConditionFor(field: ConditionField): Record<string, unknown> {
  const rule = CONDITION_FIELD_RULES[field];
  const operator = rule.operators[0]!;
  if (rule.kind === "boolean") return { field, operator };
  if (rule.kind === "number") return { field, operator, value: 70 };
  return { field, operator, value: rule.values![0]! };
}

function useProjectList<T>(projectId: string, path: string, enabled: boolean) {
  const [state, setState] = useState<{ items: T[] | null; error: string | null }>({ items: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .get<T[]>(`/projects/${projectId}/${path}`)
      .then((items) => !cancelled && setState({ items, error: null }))
      .catch((e) => !cancelled && setState({ items: null, error: e instanceof ApiError ? e.message : "Could not load the list" }));
    return () => {
      cancelled = true;
    };
  }, [projectId, path, enabled]);
  return state;
}

function DataSourceFields({ projectId, config, onConfig }: { projectId: string; config: Record<string, unknown>; onConfig: Props["onConfig"] }) {
  const { items, error } = useProjectList<DataSourceSummary>(projectId, "data-sources", true);
  const selected = Array.isArray(config.dataSourceIds) ? (config.dataSourceIds as string[]) : [];
  const toggle = (id: string) => onConfig({ ...config, dataSourceIds: selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id] });

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Data sources</legend>
        <p className="mb-2 text-xs text-slate-500">Leave everything unchecked to use all active sources.</p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {!items && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {items?.length === 0 ? <p className="text-sm text-slate-500">This project has no data sources yet.</p> : null}
        <div className="space-y-1.5">
          {items
            ?.filter((d) => d.status !== "ARCHIVED")
            .map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />
                <span className="truncate">{d.name}</span>
                <span className="text-xs text-slate-400">{d.recordCount} records</span>
              </label>
            ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={config.refresh === true} onChange={(e) => onConfig({ ...config, refresh: e.target.checked })} />
        Re-fetch from the source before running
      </label>
    </div>
  );
}

function ConditionFields({ config, onConfig }: { config: Record<string, unknown>; onConfig: Props["onConfig"] }) {
  const field = (CONDITION_FIELDS as readonly string[]).includes(String(config.field)) ? (config.field as ConditionField) : "hasMissingFields";
  const rule = CONDITION_FIELD_RULES[field];
  const operator = rule.operators.includes(config.operator as ConditionOperator) ? (config.operator as ConditionOperator) : rule.operators[0]!;
  const value = config.value;

  const setOperator = (next: ConditionOperator) => {
    if (rule.kind !== "enum") return onConfig({ ...config, field, operator: next });
    const first = Array.isArray(value) ? value[0] : typeof value === "string" ? value : rule.values![0]!;
    onConfig({ field, operator: next, value: next === "IN" ? [first] : first });
  };

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="cond-field" className="mb-1 block text-sm font-medium text-slate-700">Check</label>
        <Select id="cond-field" value={field} onChange={(e) => onConfig(defaultConditionFor(e.target.value as ConditionField))}>
          {CONDITION_FIELDS.map((f) => (
            <option key={f} value={f}>{fieldLabel[f]}</option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="cond-op" className="mb-1 block text-sm font-medium text-slate-700">Condition</label>
        <Select id="cond-op" value={operator} onChange={(e) => setOperator(e.target.value as ConditionOperator)}>
          {rule.operators.map((o) => (
            <option key={o} value={o}>{operatorLabel[o]}</option>
          ))}
        </Select>
      </div>
      {rule.kind === "number" ? (
        <div>
          <label htmlFor="cond-value" className="mb-1 block text-sm font-medium text-slate-700">Value (0 to 100)</label>
          <input
            id="cond-value"
            type="number"
            min={0}
            max={100}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onConfig({ field, operator, value: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
      ) : null}
      {rule.kind === "enum" && operator !== "IN" ? (
        <div>
          <label htmlFor="cond-value" className="mb-1 block text-sm font-medium text-slate-700">Value</label>
          <Select id="cond-value" value={typeof value === "string" ? value : rule.values![0]} onChange={(e) => onConfig({ field, operator, value: e.target.value })}>
            {rule.values!.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </Select>
        </div>
      ) : null}
      {rule.kind === "enum" && operator === "IN" ? (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Values</legend>
          <div className="space-y-1.5">
            {rule.values!.map((v) => {
              const list = Array.isArray(value) ? (value as string[]) : [];
              return (
                <label key={v} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={list.includes(v)}
                    onChange={() => {
                      const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
                      onConfig({ field, operator, value: next.length > 0 ? next : undefined });
                    }}
                  />
                  {v}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      <p className="text-xs text-slate-500">Prospects that match go out the True output. All others go out the False output. Connect both.</p>
    </div>
  );
}

function SendFields({ projectId, config, onConfig }: { projectId: string; config: Record<string, unknown>; onConfig: Props["onConfig"] }) {
  const useExisting = typeof config.campaignId === "string";
  const { items, error } = useProjectList<CampaignSummaryDto>(projectId, "campaigns", useExisting);

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Campaign</legend>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="radio" name="send-mode" checked={!useExisting} onChange={() => onConfig({ campaignName: "Workflow campaign" })} />
          Create a new campaign for each run
        </label>
        <label className="mt-1.5 flex items-center gap-2 text-sm text-slate-700">
          <input type="radio" name="send-mode" checked={useExisting} onChange={() => onConfig({ campaignId: items?.[0]?.id ?? "" })} />
          Use an existing campaign
        </label>
      </fieldset>
      {!useExisting ? (
        <div>
          <label htmlFor="send-name" className="mb-1 block text-sm font-medium text-slate-700">Campaign name</label>
          <input
            id="send-name"
            value={typeof config.campaignName === "string" ? config.campaignName : ""}
            maxLength={120}
            onChange={(e) => onConfig({ campaignName: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <p className="mt-1 text-xs text-slate-500">The run id is added to the name.</p>
        </div>
      ) : (
        <div>
          <label htmlFor="send-campaign" className="mb-1 block text-sm font-medium text-slate-700">Existing campaign</label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {!items && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}
          {items?.length === 0 ? <p className="text-sm text-slate-500">No campaigns yet. Create a new one instead.</p> : null}
          {items && items.length > 0 ? (
            <Select id="send-campaign" value={String(config.campaignId ?? "")} onChange={(e) => onConfig({ campaignId: e.target.value })}>
              {!items.some((c) => c.id === config.campaignId) ? <option value="">Choose a campaign</option> : null}
              {items.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          ) : null}
          <p className="mt-1 text-xs text-amber-700">Every sendable email already in that campaign is sent too.</p>
        </div>
      )}
      <p className="text-xs text-slate-500">Sends are simulated. No real email leaves the system.</p>
    </div>
  );
}

function fieldErrors(node: DraftNode): string[] {
  const parsed = NODE_CONFIG_SCHEMAS[node.type].safeParse(node.config);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => {
    const where = i.path.length > 0 ? `${String(i.path[0])}: ` : "";
    return `${where}${i.message}`;
  });
}

export function NodeConfigPanel({ projectId, node, onRename, onConfig, onRemove, onClose, issues }: Props) {
  const entry = NODE_CATALOG[node.type];
  const visual = NODE_VISUALS[node.type];
  const Icon = visual.icon;
  const problems = [...fieldErrors(node), ...issues.filter((i) => i.code !== "SCHEMA").map((i) => i.message)];
  const unique = [...new Set(problems)];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${visual.chip}`}>
          <Icon size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-slate-900">{node.label ?? entry.label}</h2>
          <p className="text-xs text-slate-500">{entry.label}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <X size={16} aria-hidden />
          <span className="sr-only">Close settings</span>
        </button>
      </div>
      <p className="text-sm text-slate-600">{entry.description}</p>

      {unique.length > 0 ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertTriangle size={14} aria-hidden /> Fix before publishing
          </div>
          <ul className="list-disc space-y-0.5 pl-5">
            {unique.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <label htmlFor="node-label" className="mb-1 block text-sm font-medium text-slate-700">Name on the canvas</label>
        <input
          id="node-label"
          value={node.label ?? ""}
          placeholder={entry.label}
          maxLength={80}
          onChange={(e) => onRename(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {node.type === "DATA_SOURCE" ? <DataSourceFields projectId={projectId} config={node.config} onConfig={onConfig} /> : null}
      {node.type === "CONDITION" ? <ConditionFields config={node.config} onConfig={onConfig} /> : null}
      {node.type === "SIMULATED_SEND" ? <SendFields projectId={projectId} config={node.config} onConfig={onConfig} /> : null}
      {node.type === "HUMAN_APPROVAL" ? (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={node.config.requireAllReviewed !== false} onChange={(e) => onConfig({ requireAllReviewed: e.target.checked })} />
          <span>
            Require a decision on every email before continuing
            <span className="block text-xs text-slate-500">Emails left undecided leave through the Rejected output.</span>
          </span>
        </label>
      ) : null}
      {["NORMALIZE", "QUALIFY", "ENRICH", "REQUALIFY", "GENERATE_EMAIL", "AI_QA"].includes(node.type) ? <p className="text-sm text-slate-500">This step has no settings.</p> : null}
      {entry.usesLlm ? <p className="text-xs text-slate-500">Uses the AI provider selected in Settings.</p> : null}

      <div className="border-t border-slate-100 pt-3">
        <Button variant="danger" onClick={onRemove}>
          <Trash2 size={14} /> Remove step
        </Button>
      </div>
    </div>
  );
}
