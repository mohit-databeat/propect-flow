"use client";

import { useMemo, useState, type DragEvent } from "react";
import { GripVertical, Search } from "lucide-react";
import { NODE_CATALOG_LIST, type WorkflowDraftDefinition, type WorkflowNodeType } from "@prospect/shared";
import { CATEGORY_LABEL, CATEGORY_ORDER, DND_MIME, NODE_VISUALS } from "./node-visuals";

interface Props {
  definition: WorkflowDraftDefinition;
  disabled?: boolean;
  onAdd: (type: WorkflowNodeType) => void;
}

export function NodePalette({ definition, disabled = false, onAdd }: Props) {
  const [query, setQuery] = useState("");
  const hasSource = definition.nodes.some((n) => n.type === "DATA_SOURCE");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATEGORY_ORDER.map((category) => ({
      category,
      entries: NODE_CATALOG_LIST.filter(
        (e) => e.category === category && (q === "" || e.label.toLowerCase().includes(q) || CATEGORY_LABEL[category].toLowerCase().includes(q)),
      ),
    })).filter((g) => g.entries.length > 0);
  }, [query]);

  const onDragStart = (event: DragEvent, type: WorkflowNodeType) => {
    event.dataTransfer.setData(DND_MIME, type);
    event.dataTransfer.setData("text/plain", type);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <nav aria-label="Workflow steps" className="space-y-4">
      <div className="relative">
        <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <label htmlFor="palette-search" className="sr-only">Search steps</label>
        <input
          id="palette-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search steps"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
      </div>
      <p className="text-xs text-slate-500">Drag a step onto the canvas, or click it to add it.</p>

      {groups.length === 0 ? <p className="text-sm text-slate-500">No steps match &ldquo;{query}&rdquo;.</p> : null}

      {groups.map(({ category, entries }) => (
        <div key={category}>
          <h3 className="mb-1.5 text-lg font-semibold tracking-tight text-slate-900">{CATEGORY_LABEL[category]}</h3>
          <ul className="space-y-2">
            {entries.map((e) => {
              const blocked = disabled || (e.type === "DATA_SOURCE" && hasSource);
              const visual = NODE_VISUALS[e.type];
              const Icon = visual.icon;
              return (
                <li key={e.type}>
                  <button
                    type="button"
                    draggable={!blocked}
                    disabled={blocked}
                    onDragStart={(ev) => onDragStart(ev, e.type)}
                    onClick={() => onAdd(e.type)}
                    title={blocked && !disabled ? "A workflow can have only one Data Source" : e.description}
                    className="flex w-full cursor-grab items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${visual.chip}`}>
                      <Icon size={16} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{e.label}</span>
                    <GripVertical size={16} aria-hidden className="shrink-0 text-slate-300" />
                    <span className="sr-only">Add {e.label} to the workflow</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
