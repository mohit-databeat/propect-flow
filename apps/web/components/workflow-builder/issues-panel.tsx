"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ValidationIssue } from "@prospect/shared";

export function IssuesPanel({ issues, checked, onSelectNode }: { issues: readonly ValidationIssue[]; checked: boolean; onSelectNode: (nodeId: string) => void }) {
  if (!checked) return <p className="text-sm text-slate-500">Press Validate to check this workflow before you publish it.</p>;
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-700">
        <CheckCircle2 size={16} aria-hidden /> No problems found. This workflow can be published.
      </p>
    );
  }

  return (
    <div role="alert" aria-live="polite">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-red-700">
        <AlertTriangle size={16} aria-hidden /> {issues.length} problem{issues.length === 1 ? "" : "s"} to fix
      </p>
      <ul className="space-y-1.5">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? i}-${i}`} className="rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-sm text-red-800">
            {issue.nodeId ? (
              <button type="button" className="text-left underline decoration-red-300 underline-offset-2 hover:decoration-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500" onClick={() => onSelectNode(issue.nodeId!)}>
                {issue.message}
              </button>
            ) : (
              issue.message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
