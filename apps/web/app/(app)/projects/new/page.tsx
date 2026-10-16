"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../../../lib/api";
import { PageHeader } from "../../../../components/layout/page-header";
import { Card, CardBody } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { useToast } from "../../../../components/ui/toast";

interface ProjectSummary {
  id: string;
}

export default function CreateProjectPage() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const project = await api.post<ProjectSummary>("/projects", { name, description: description || undefined });
      toast.success(`Project "${name}" created.`);
      router.push(`/projects/${project.id}/icp`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to create project";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Create project" description="Give your prospecting workflow a name. You'll define the ICP next." />
      <Card>
        <CardBody>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Project name</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. US SaaS Sales Expansion"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? "Creating…" : "Create project"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
