import { Zap } from "lucide-react";

export function Logo({ withWordmark = true, size = "md", tone = "dark" }: { withWordmark?: boolean; size?: "sm" | "md"; tone?: "dark" | "light" }) {
  const box = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const icon = size === "sm" ? 15 : 18;
  return (
    <div className="flex items-center gap-2.5">
      <div className={`flex ${box} shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card`}>
        <Zap size={icon} strokeWidth={2.5} fill="currentColor" />
      </div>
      {withWordmark ? <span className={`text-lg font-semibold tracking-tight ${tone === "light" ? "text-white" : "text-slate-900"}`}>ProspectFlow</span> : null}
    </div>
  );
}
