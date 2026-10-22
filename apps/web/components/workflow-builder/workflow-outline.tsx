"use client";

import { useState } from "react";
import { Link2, Trash2 } from "lucide-react";
import { NODE_CATALOG, connect, disconnect, removeNode, type WorkflowDraftDefinition } from "@prospect/shared";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { nodeTitle } from "./workflow-canvas";

interface Props {
  definition: WorkflowDraftDefinition;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  onChange: (definition: WorkflowDraftDefinition) => void;
  onRejected: (reason: string) => void;
}

export function WorkflowOutline({ definition, selectedId, onSelect, onChange, onRejected }: Props) {
  const [from, setFrom] = useState("");
  const [handle, setHandle] = useState("");
  const [to, setTo] = useState("");

  const titleOf = (id: string) => {
    const n = definition.nodes.find((x) => x.id === id);
    return n ? nodeTitle(n) : id;
  };
  const sourceNode = definition.nodes.find((n) => n.id === from);
  const sourceHandles = sourceNode ? NODE_CATALOG[sourceNode.type].outputHandles : [];
  const chosenHandle = sourceHandles.some((h) => h.id === handle) ? handle : (sourceHandles[0]?.id ?? "");

  const add = () => {
    const result = connect(definition, { source: from, sourceHandle: chosenHandle, target: to });
    if (result.ok) onChange(result.definition);
    else onRejected(result.reason);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="outline-steps">
        <h3 id="outline-steps" className="mb-2 text-sm font-medium text-slate-700">Steps</h3>
        {definition.nodes.length === 0 ? <p className="text-sm text-slate-500">No steps yet. Add one from the list on the left.</p> : null}
        <ul className="space-y-1.5">
          {definition.nodes.map((n) => (
            <li key={n.id} className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${n.id === selectedId ? "border-brand-400 bg-brand-50" : "border-slate-200 bg-white"}`}>
              <button type="button" onClick={() => onSelect(n.id)} aria-pressed={n.id === selectedId} className="min-w-0 flex-1 truncate text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                <span className="font-medium text-slate-800">{nodeTitle(n)}</span>
                <span className="ml-2 text-xs text-slate-400">{NODE_CATALOG[n.type].label}</span>
              </button>
              <button
                type="button"
                onClick={() => onChange(removeNode(definition, n.id))}
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                <Trash2 size={14} aria-hidden />
                <span className="sr-only">Remove {nodeTitle(n)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="outline-links">
        <h3 id="outline-links" className="mb-2 text-sm font-medium text-slate-700">Connections</h3>
        {definition.edges.length === 0 ? <p className="mb-2 text-sm text-slate-500">Nothing is connected yet.</p> : null}
        <ul className="mb-3 space-y-1.5">
          {definition.edges.map((e) => {
            const sourceType = definition.nodes.find((n) => n.id === e.source)?.type;
            const handles = sourceType ? NODE_CATALOG[sourceType].outputHandles : [];
            const handleLabel = handles.length > 1 ? ` (${handles.find((h) => h.id === e.sourceHandle)?.label ?? e.sourceHandle})` : "";
            return (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm">
                <span className="min-w-0 truncate">
                  {titleOf(e.source)}
                  {handleLabel} <span aria-hidden>to</span> <span className="sr-only">connects to</span> {titleOf(e.target)}
                </span>
                <button type="button" onClick={() => onChange(disconnect(definition, e.id))} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
                  <Trash2 size={14} aria-hidden />
                  <span className="sr-only">Remove connection from {titleOf(e.source)} to {titleOf(e.target)}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <form
          className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            add();
          }}
        >
          <div className="text-sm font-medium text-slate-700">Connect two steps</div>
          <div>
            <label htmlFor="link-from" className="mb-1 block text-xs text-slate-600">From</label>
            <Select id="link-from" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Choose a step</option>
              {definition.nodes.filter((n) => NODE_CATALOG[n.type].outputHandles.length > 0).map((n) => (
                <option key={n.id} value={n.id}>{nodeTitle(n)}</option>
              ))}
            </Select>
          </div>
          {sourceHandles.length > 1 ? (
            <div>
              <label htmlFor="link-output" className="mb-1 block text-xs text-slate-600">Output</label>
              <Select id="link-output" value={chosenHandle} onChange={(e) => setHandle(e.target.value)}>
                {sourceHandles.map((h) => (
                  <option key={h.id} value={h.id}>{h.label}</option>
                ))}
              </Select>
            </div>
          ) : null}
          <div>
            <label htmlFor="link-to" className="mb-1 block text-xs text-slate-600">To</label>
            <Select id="link-to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose a step</option>
              {definition.nodes.filter((n) => NODE_CATALOG[n.type].inputKind !== null).map((n) => (
                <option key={n.id} value={n.id}>{nodeTitle(n)}</option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary" disabled={!from || !to}>
            <Link2 size={14} /> Connect
          </Button>
        </form>
      </section>
    </div>
  );
}
