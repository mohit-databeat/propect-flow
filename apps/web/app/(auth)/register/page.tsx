"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import { api, ApiError } from "../../../lib/api";
import { authStorage } from "../../../lib/auth";
import { Button } from "../../../components/ui/button";
import { Logo } from "../../../components/layout/logo";
import { useToast } from "../../../components/ui/toast";
import { PasswordInput } from "../../../components/ui/password-input";

const FEATURES = ["Flexible data sources", "AI-driven qualification", "Personalized outreach", "Scale your pipeline"];

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

export default function RegisterPage() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<AuthResponse>("/auth/register", { name, email, password }, { auth: false });
      authStorage.set(res.accessToken, res.refreshToken);
      toast.success(`Welcome, ${res.user.name} — your workspace is ready.`);
      router.push("/dashboard");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Unable to create your account. Is the API running?";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-white">
      <div
        className="relative hidden w-[42%] shrink-0 flex-col justify-between overflow-hidden bg-brand-800 bg-gradient-to-br from-brand-800 via-brand-700 to-brand-900 px-10 py-10 lg:flex"
        style={{ backgroundColor: "#1e2e7d" }}
      >
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-white/5" />
        <Logo tone="light" />
        <div className="relative z-10 max-w-sm">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">Turn your ideal customers into conversations</h1>
          <p className="mt-3 text-sm text-white/80">AI-powered prospecting and outreach workflows for modern revenue teams.</p>
          <ul className="mt-8 space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-white">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-white">
                  <Check size={12} strokeWidth={3} />
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Create your account</h2>
          <p className="mt-1 text-sm text-slate-500">Starts a new workspace you'll own.</p>

          <form className="mt-7 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
              <PasswordInput required minLength={8} value={password} onChange={setPassword} />
              <p className="mt-1 text-xs text-slate-400">At least 8 characters.</p>
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <Button type="submit" disabled={loading} className="w-full py-2.5">
              {loading ? "Creating account…" : "Create account"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
