"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { ChevronLeft, FolderKanban, MessageSquare, Database, Workflow, GitBranch, Users, Mail, Megaphone, BarChart3 } from "lucide-react";
import type { ProjectSummary } from "@prospect/shared";
import { api } from "../../../../lib/api";
import { Badge } from "../../../../components/ui/badge";

const statusTone = { DRAFT: "neutral", ACTIVE: "success", ARCHIVED: "warning" } as const;

const TABS = [
  { key: "icp", label: "ICP", icon: MessageSquare },
  { key: "data-sources", label: "Data Sources", icon: Database },
  { key: "workflow", label: "Workflow", icon: Workflow },
  { key: "workflows", label: "Workflow Builder", icon: GitBranch },
  { key: "prospects", label: "Prospects", icon: Users },
  { key: "emails", label: "Emails", icon: Mail },
  { key: "campaigns", label: "Campaigns", icon: Megaphone },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
];

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectSummary | null>(null);

  useEffect(() => {
    api
      .get<ProjectSummary>(`/projects/${params.id}`)
      .then(setProject)
      .catch((e) => console.warn("Failed to load project for layout header:", e));
  }, [params.id]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2.5">
        <Link href="/projects" className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
          <ChevronLeft size={14} /> Projects
        </Link>
        <span className="text-slate-300">/</span>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <FolderKanban size={14} strokeWidth={2} />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">{project?.name ?? "Loading…"}</h1>
        {project ? <Badge tone={statusTone[project.status]}>{project.status}</Badge> : null}
      </div>

      <nav className="mb-6 flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => {
          const href = `/projects/${params.id}/${tab.key}`;
          const active = pathname === href || pathname?.startsWith(`${href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={href}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
                active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon size={15} strokeWidth={2} />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
