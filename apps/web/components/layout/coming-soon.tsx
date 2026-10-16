import { Construction } from "lucide-react";
import { PageHeader } from "./page-header";
import { Card, CardBody } from "../ui/card";

export function ComingSoon({ title, description, phase }: { title: string; description?: string; phase: string }) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Construction size={22} strokeWidth={1.75} />
          </div>
          <p className="text-sm font-medium text-slate-700">Coming in {phase}</p>
          <p className="max-w-sm text-sm text-slate-500">This page is scaffolded for navigation. The underlying functionality is planned for a later build phase.</p>
        </CardBody>
      </Card>
    </div>
  );
}
