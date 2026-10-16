"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, ChevronDown, User, LogOut } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { authStorage } from "../../lib/auth";

interface MeResponse {
  user: { id: string; email: string; name: string; avatarUrl: string | null };
  memberships: { workspaceId: string; workspaceName: string; role: string }[];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
}

export function Topbar() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<MeResponse>("/auth/me")
      .then((res) => {
        if (!cancelled) setMe(res);
      })
      .catch((e) => {
        if (!(e instanceof ApiError)) throw e;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const logout = () => {
    authStorage.clear();
    router.push("/login");
  };

  const workspaceName = me?.memberships[0]?.workspaceName ?? "Workspace";

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6">
      <div className="relative w-full max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Search…"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
      </div>

      <div ref={menuRef} className="relative shrink-0">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-100">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {me?.user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.user.avatarUrl} alt={me.user.name} className="h-full w-full object-cover" />
            ) : me ? (
              initials(me.user.name)
            ) : (
              "…"
            )}
          </div>
          <div className="hidden text-left sm:block">
            <div className="text-sm font-medium leading-tight text-slate-800">{me?.user.name ?? "Loading…"}</div>
            <div className="text-xs leading-tight text-slate-400">{workspaceName}</div>
          </div>
          <ChevronDown size={15} className="text-slate-400" />
        </button>

        {open ? (
          <div className="absolute right-0 top-full z-20 mt-2 w-52 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
            <div className="border-b border-slate-100 px-3.5 py-2.5">
              <div className="text-sm font-medium text-slate-800">{me?.user.name}</div>
              <div className="truncate text-xs text-slate-400">{me?.user.email}</div>
            </div>
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <User size={15} /> Your profile
            </Link>
            <button onClick={logout} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-red-600 hover:bg-red-50">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
