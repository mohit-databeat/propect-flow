"use client";

import type { IcpCriterion } from "@prospect/shared";
import { Badge } from "../ui/badge";

function operatorLabel(c: IcpCriterion): string {
  if (c.kind === "QUALITATIVE") return "AI-assessed";
  switch (c.operator) {
    case "EQ":
      return `= ${JSON.stringify(c.value)}`;
    case "NEQ":
      return `≠ ${JSON.stringify(c.value)}`;
    case "IN":
      return `in [${(c.value as string[]).join(", ")}]`;
    case "NOT_IN":
      return `not in [${(c.value as string[]).join(", ")}]`;
    case "GTE":
      return `≥ ${c.value}`;
    case "LTE":
      return `≤ ${c.value}`;
    case "BETWEEN": {
      const v = c.value as { min?: number; max?: number };
      return `between ${v.min ?? "–"} and ${v.max ?? "–"}`;
    }
    case "CONTAINS_ANY":
      return `contains any of [${(c.value as string[]).join(", ")}]`;
    case "CONTAINS_ALL":
      return `contains all of [${(c.value as string[]).join(", ")}]`;
    case "EXISTS":
      return "exists";
    default:
      return "";
  }
}

export function CriterionCard({
  criterion,
  onWeightChange,
  onRequiredChange,
  readOnly = false,
}: {
  criterion: IcpCriterion;
  onWeightChange?: (weight: number) => void;
  onRequiredChange?: (required: boolean) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-slate-900">{criterion.label}</div>
          <div className="mt-0.5 font-mono text-xs text-slate-500">
            {criterion.kind === "DETERMINISTIC" ? criterion.field : "qualitative"} {operatorLabel(criterion)}
          </div>
        </div>
        <Badge tone={criterion.required ? "danger" : "neutral"}>{criterion.required ? "Required" : "Soft"}</Badge>
      </div>
      {criterion.kind === "QUALITATIVE" ? <p className="mt-2 text-xs text-slate-500">{criterion.question}</p> : null}
      <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={criterion.required} disabled={readOnly} onChange={(e) => onRequiredChange?.(e.target.checked)} />
          Required (hard filter)
        </label>
        <label className="flex items-center gap-1.5">
          Weight
          <input
            type="number"
            min={0}
            max={10}
            value={criterion.weight}
            disabled={readOnly}
            onChange={(e) => onWeightChange?.(Number(e.target.value))}
            className="w-14 rounded border border-slate-300 px-1.5 py-0.5 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>
      </div>
    </div>
  );
}
