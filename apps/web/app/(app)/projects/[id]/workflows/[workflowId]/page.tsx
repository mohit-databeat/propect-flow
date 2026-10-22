"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, CheckCheck, MousePointerClick, Maximize2, Minimize2, Network, Play, Save, Upload } from "lucide-react";
import {
  addNode,
  autoLayout,
  nextFreePosition,
  removeNode,
  renameNode,
  setNodeConfig,
  type PublishWorkflowResponse,
  type StartWorkflowExecutionResponse,
  type ValidationIssue,
  type WorkflowDetailDto,
  type WorkflowDraftDefinition,
  type WorkflowNodeType,
  type WorkflowValidationResponse,
  type WorkflowVersionDto,
} from "@prospect/shared";
import { api, ApiError } from "../../../../../../lib/api";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import { Card, CardBody, CardHeader } from "../../../../../../components/ui/card";
import { Select } from "../../../../../../components/ui/select";
import { useToast } from "../../../../../../components/ui/toast";
import { IssuesPanel } from "../../../../../../components/workflow-builder/issues-panel";
import { NodeConfigPanel } from "../../../../../../components/workflow-builder/node-config-panel";
import { NodePalette } from "../../../../../../components/workflow-builder/node-palette";
import { WorkflowCanvas } from "../../../../../../components/workflow-builder/workflow-canvas";
import { WorkflowOutline } from "../../../../../../components/workflow-builder/workflow-outline";

function asIssues(details: unknown): ValidationIssue[] | null {
  if (!Array.isArray(details)) return null;
  const issues = details.filter((d): d is ValidationIssue => typeof d === "object" && d !== null && "code" in d && "message" in d);
  return issues.length > 0 ? issues : null;
}

export default function WorkflowEditorPage() {
  const params = useParams<{ id: string; workflowId: string }>();
  const { id: projectId, workflowId } = params;
  const router = useRouter();
  const toast = useToast();
  const base = `/projects/${projectId}/workflows/${workflowId}`;

  const [workflow, setWorkflow] = useState<WorkflowDetailDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [definition, setDefinition] = useState<WorkflowDraftDefinition | null>(null);
  const [name, setName] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [focusMode, setFocusMode] = useState(false);

  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [checked, setChecked] = useState(false);
  const [versions, setVersions] = useState<WorkflowVersionDto[]>([]);
  const [versionId, setVersionId] = useState("");
  const [busy, setBusy] = useState<null | "save" | "validate" | "publish" | "run">(null);

  const snapshotOf = (n: string, d: WorkflowDraftDefinition | null) => JSON.stringify({ n, d });
  const dirty = definition !== null && snapshotOf(name, definition) !== savedSnapshot;
  const archived = workflow?.status === "ARCHIVED";

  const loadVersions = useCallback(async () => {
    const list = await api.get<WorkflowVersionDto[]>(`${base}/versions`);
    setVersions(list);
    setVersionId((current) => (list.some((v) => v.id === current) ? current : (list[0]?.id ?? "")));
    return list;
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [detail] = await Promise.all([api.get<WorkflowDetailDto>(base), loadVersions()]);
        if (cancelled) return;
        setWorkflow(detail);
        setName(detail.name);
        setDefinition(detail.definition);
        setSavedSnapshot(snapshotOf(detail.name, detail.definition));
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof ApiError ? e.message : "Failed to load the workflow");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, loadVersions]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFocusMode(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode]);

  const change = useCallback(
    (next: WorkflowDraftDefinition) => {
      if (archived) return;
      setDefinition(next);
      setIssues([]);
      setChecked(false);
    },
    [archived],
  );

  const selectedNode = useMemo(() => definition?.nodes.find((n) => n.id === selectedId) ?? null, [definition, selectedId]);
  const selectedIssues = useMemo(() => issues.filter((i) => i.nodeId === selectedId), [issues, selectedId]);

  const place = (type: WorkflowNodeType, position: { x: number; y: number }) => {
    if (!definition || archived) return;
    if (type === "DATA_SOURCE" && definition.nodes.some((n) => n.type === "DATA_SOURCE")) {
      toast.error("A workflow can have only one Data Source.");
      return;
    }
    const result = addNode(definition, type, position);
    if (!result) return toast.error("This workflow has reached the step limit.");
    change(result.definition);
    setSelectedId(result.nodeId);
  };

  const handleAdd = (type: WorkflowNodeType) => {
    if (!definition) return;
    place(type, nextFreePosition(definition, selectedId));
  };

  const tidy = () => {
    if (!definition) return;
    change(autoLayout(definition));
    setFitKey((k) => k + 1);
    toast.success("Steps arranged top to bottom.");
  };

  const save = async (): Promise<boolean> => {
    if (!definition) return false;
    setBusy("save");
    try {
      const saved = await api.patch<WorkflowDetailDto>(base, { name: name.trim(), definition });
      setWorkflow(saved);
      setName(saved.name);
      setSavedSnapshot(snapshotOf(saved.name, definition));
      toast.success("Workflow saved.");
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save the workflow");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const validate = async () => {
    if (!definition) return;
    setBusy("validate");
    try {
      const result = await api.post<WorkflowValidationResponse>(`${base}/validate`, { definition });
      setIssues(result.issues);
      setChecked(true);
      if (result.valid) toast.success("No problems found.");
      else toast.error(`${result.issues.length} problem(s) found.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Validation failed to run");
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    if (dirty && !(await save())) return;
    setBusy("publish");
    try {
      const result = await api.post<PublishWorkflowResponse>(`${base}/versions`, {});
      await loadVersions();
      setVersionId(result.id);
      setIssues([]);
      setChecked(true);
      toast.success(result.alreadyPublished ? `Nothing changed. Version ${result.version} is already current.` : `Published version ${result.version}.`);
    } catch (e) {
      if (e instanceof ApiError) {
        const found = asIssues(e.details);
        if (found) {
          setIssues(found);
          setChecked(true);
        }
        toast.error(e.message);
      } else {
        toast.error("Failed to publish the workflow");
      }
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    if (!versionId) return;
    setBusy("run");
    try {
      const { runId } = await api.post<StartWorkflowExecutionResponse>(`${base}/executions`, { versionId });
      toast.success("Run started.");
      router.push(`${base}/runs/${runId}`);
    } catch (e) {
      if (e instanceof ApiError) {
        const found = asIssues(e.details);
        if (found) {
          setIssues(found);
          setChecked(true);
        }
        toast.error(e.message);
      } else {
        toast.error("Failed to start the run");
      }
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600">{loadError}</p>
        <Link href={`/projects/${projectId}/workflows`} className="text-sm text-brand-600 underline">Back to workflows</Link>
      </div>
    );
  }
  if (!workflow || !definition) return <p className="text-sm text-slate-500">Loading…</p>;

  const selectedVersion = versions.find((v) => v.id === versionId);
  const gridClass = focusMode ? "xl:grid-cols-[230px_minmax(0,1fr)_310px]" : "2xl:grid-cols-[230px_minmax(0,1fr)_310px]";
  const spanClass = focusMode ? "xl:col-span-1" : "2xl:col-span-1";
  const orderCanvas = focusMode ? "xl:order-2" : "2xl:order-2";
  const orderPalette = focusMode ? "xl:order-1" : "2xl:order-1";
  const canvasHeight = focusMode ? "h-[calc(100vh-190px)] min-h-[520px]" : "h-[560px] 2xl:h-[calc(100vh-330px)] 2xl:min-h-[600px]";
  const sideHeight = focusMode ? "max-h-[560px] xl:max-h-none xl:h-[calc(100vh-190px)]" : "max-h-[560px] 2xl:max-h-none 2xl:h-[calc(100vh-330px)] 2xl:min-h-[600px]";

  return (
    <div className={focusMode ? "fixed inset-0 z-40 space-y-3 overflow-y-auto bg-slate-50 p-4" : "space-y-4"} data-testid="workflow-editor">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Link href={`/projects/${projectId}/workflows`} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
            <ChevronLeft size={14} aria-hidden /> Workflows
          </Link>
          <label htmlFor="wf-title" className="sr-only">Workflow name</label>
          <input
            id="wf-title"
            value={name}
            maxLength={120}
            disabled={archived}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold text-slate-900 hover:border-slate-200 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          {dirty ? <Badge tone="warning">Unsaved changes</Badge> : <Badge tone="neutral">Saved</Badge>}
          {archived ? <Badge tone="warning">Archived</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={tidy} disabled={archived || definition.nodes.length === 0} title="Arrange the steps top to bottom">
            <Network size={14} /> Layout
          </Button>
          <Button variant="secondary" onClick={() => setFocusMode((v) => !v)} aria-pressed={focusMode} title={focusMode ? "Leave full screen (Esc)" : "Full screen"}>
            {focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            <span className="sr-only">{focusMode ? "Leave full screen" : "Full screen"}</span>
          </Button>
          <Button variant="secondary" onClick={() => void save()} disabled={archived || !dirty || busy !== null || !name.trim()}>
            <Save size={14} /> {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button variant="secondary" onClick={() => void validate()} disabled={busy !== null}>
            <CheckCheck size={14} /> {busy === "validate" ? "Checking…" : "Validate"}
          </Button>
          <Button variant="secondary" onClick={() => void publish()} disabled={archived || busy !== null || definition.nodes.length === 0}>
            <Upload size={14} /> {busy === "publish" ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-600">
            {versions.length === 0 ? "Publish this workflow to create a version you can run." : "Runs always use a published version. Choose which one to run:"}
          </div>
          {versions.length > 0 ? (
            <div className="flex items-center gap-2">
              <label htmlFor="run-version" className="sr-only">Version to run</label>
              <Select id="run-version" className="w-52" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    Version {v.version}
                    {v.note ? `: ${v.note}` : ""}
                  </option>
                ))}
              </Select>
              <Button onClick={() => void run()} disabled={archived || busy !== null || !versionId}>
                <Play size={14} /> {busy === "run" ? "Starting…" : "Run"}
              </Button>
            </div>
          ) : null}
        </CardBody>
        {dirty && selectedVersion ? (
          <CardBody className="border-t border-slate-100 py-2 text-xs text-amber-700">
            You have unsaved or unpublished edits. Version {selectedVersion.version} runs as it was when published.
          </CardBody>
        ) : null}
      </Card>

      <div className={`grid gap-4 md:grid-cols-2 ${gridClass}`}>
        <Card className={`order-2 overflow-y-auto ${orderPalette} ${sideHeight}`}>
          <CardBody>
            <NodePalette definition={definition} disabled={archived} onAdd={handleAdd} />
          </CardBody>
        </Card>

        <div className={`order-1 min-w-0 md:col-span-2 ${spanClass} ${orderCanvas}`}>
          <WorkflowCanvas
            definition={definition}
            selectedId={selectedId}
            issues={issues}
            fitKey={fitKey}
            className={canvasHeight}
            onSelect={setSelectedId}
            onChange={archived ? undefined : change}
            onRejected={(reason) => toast.error(reason)}
            onDropNode={archived ? undefined : place}
            readOnly={archived}
          />
          <p className="mt-2 text-xs text-slate-500">
            Drag from the dot under a step to the dot above another to connect them. Select a step or connection and press Delete to remove it. Scroll to zoom, drag the background to move around.
          </p>
        </div>

        <div className={`order-3 space-y-4 overflow-y-auto ${sideHeight}`}>
          <Card>
            <CardBody>
              {selectedNode ? (
                <NodeConfigPanel
                  key={selectedNode.id}
                  projectId={projectId}
                  node={selectedNode}
                  issues={selectedIssues}
                  onClose={() => setSelectedId(null)}
                  onRename={(label) => change(renameNode(definition, selectedNode.id, label))}
                  onConfig={(config) => change(setNodeConfig(definition, selectedNode.id, config))}
                  onRemove={() => {
                    change(removeNode(definition, selectedNode.id));
                    setSelectedId(null);
                  }}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <MousePointerClick size={26} className="text-slate-300" aria-hidden />
                  <p className="text-sm font-medium text-slate-700">No step selected</p>
                  <p className="text-sm text-slate-500">Select a step on the canvas to change its settings. {definition.nodes.length === 0 ? "Start by dragging a Data Source in." : ""}</p>
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader className="text-sm font-medium text-slate-700">Checks</CardHeader>
            <CardBody>
              <IssuesPanel issues={issues} checked={checked} onSelectNode={setSelectedId} />
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="text-sm font-medium text-slate-700">List view</CardHeader>
        <CardBody>
          <p className="mb-4 text-sm text-slate-500">The same steps and connections as the canvas, usable with a keyboard or screen reader. Changes here and on the canvas stay in sync.</p>
          <WorkflowOutline definition={definition} selectedId={selectedId} onSelect={setSelectedId} onChange={change} onRejected={(reason) => toast.error(reason)} />
        </CardBody>
      </Card>
    </div>
  );
}
