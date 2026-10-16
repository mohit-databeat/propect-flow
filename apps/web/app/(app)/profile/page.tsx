"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Trash2 } from "lucide-react";
import type { UserSummary } from "@prospect/shared";
import { api, ApiError } from "../../../lib/api";
import { API_URL } from "../../../lib/config";
import { authStorage } from "../../../lib/auth";
import { PageHeader } from "../../../components/layout/page-header";
import { Card, CardBody, CardHeader } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { PasswordInput } from "../../../components/ui/password-input";
import { useToast } from "../../../components/ui/toast";

interface MeResponse {
  user: UserSummary;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
}

export default function ProfilePage() {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<UserSummary | null>(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const load = () => {
    api
      .get<MeResponse>("/auth/me")
      .then((res) => {
        setUser(res.user);
        setName(res.user.name);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "Failed to load profile"));
  };

  useEffect(load, []);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingName(true);
    try {
      const updated = await api.patch<UserSummary>("/auth/me", { name: name.trim() });
      setUser(updated);
      toast.success("Name updated.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to update name");
    } finally {
      setSavingName(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation don't match.");
      return;
    }
    setChangingPassword(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  };

  const onAvatarFile = async (file: File) => {
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_URL}/auth/me/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authStorage.accessToken}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch((parseErr) => {
          console.warn("Failed to parse avatar upload error response body:", parseErr);
          return { message: res.statusText };
        });
        throw new Error(body.message ?? "Upload failed");
      }
      const updated = (await res.json()) as UserSummary;
      setUser(updated);
      toast.success("Profile photo updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload photo");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    setUploadingAvatar(true);
    try {
      const updated = await api.delete<UserSummary>("/auth/me/avatar");
      setUser(updated);
      toast.success("Profile photo removed.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to remove photo");
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (!user) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Your profile" description="Manage your personal account details." />

      <Card>
        <CardHeader className="text-sm font-medium text-slate-700">Photo</CardHeader>
        <CardBody className="flex items-center gap-5">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-xl font-semibold text-brand-700">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt={user.name} className="h-full w-full object-cover" />
            ) : (
              initials(user.name)
            )}
          </div>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onAvatarFile(file);
                e.target.value = "";
              }}
            />
            <Button variant="secondary" disabled={uploadingAvatar} onClick={() => fileInputRef.current?.click()}>
              <Camera size={14} /> {uploadingAvatar ? "Uploading…" : "Upload photo"}
            </Button>
            {user.avatarUrl ? (
              <Button variant="danger" disabled={uploadingAvatar} onClick={removeAvatar}>
                <Trash2 size={14} /> Remove
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="text-sm font-medium text-slate-700">Account details</CardHeader>
        <CardBody>
          <form className="space-y-4" onSubmit={saveName}>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <input disabled value={user.email} className="w-full max-w-sm rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
            </div>
            <Button type="submit" disabled={savingName || name.trim() === user.name}>
              {savingName ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="text-sm font-medium text-slate-700">Change password</CardHeader>
        <CardBody>
          <form className="max-w-sm space-y-4" onSubmit={changePassword}>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Current password</label>
              <PasswordInput required value={currentPassword} onChange={setCurrentPassword} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">New password</label>
              <PasswordInput required minLength={8} value={newPassword} onChange={setNewPassword} />
              <p className="mt-1 text-xs text-slate-400">At least 8 characters.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Confirm new password</label>
              <PasswordInput required minLength={8} value={confirmPassword} onChange={setConfirmPassword} />
            </div>
            <Button type="submit" disabled={changingPassword || !currentPassword || !newPassword}>
              {changingPassword ? "Changing…" : "Change password"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
