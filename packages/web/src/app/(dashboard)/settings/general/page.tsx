"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import {
  User,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageBanner, type MessageBannerMsg } from "@/components/ui/message-banner";
import { Separator } from "@/components/ui/separator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserSettings {
  nickname: string | null;
  slug: string | null;
  is_public: boolean;
}

// ---------------------------------------------------------------------------
// Settings Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { data: session } = useSession();

  // User settings state — disable focus revalidation to prevent overwriting
  // unsaved form edits when the user tabs away and back.
  const { data: settingsData, mutate: mutateSettings } = useSWR<UserSettings>(
    "/api/settings",
    fetcher,
    { revalidateOnFocus: false },
  );
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [nickname, setNickname] = useState("");
  const [slug, setSlug] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<MessageBannerMsg | null>(null);

  // Sync SWR data to local form state once per arrival (render-time update pattern).
  const [syncedSettings, setSyncedSettings] = useState<UserSettings | null>(null);
  if (settingsData && settingsData !== syncedSettings) {
    setSyncedSettings(settingsData);
    setSettings(settingsData);
    setNickname(settingsData.nickname ?? "");
    setSlug(settingsData.slug ?? "");
    setIsPublic(settingsData.is_public ?? false);
  }

  // Delete account state
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";
  const userImage = session?.user?.image;
  const userId = session?.user?.id;

  // Profile URL state
  const [copiedUrl, setCopiedUrl] = useState(false);
  const profileIdentifier = slug || userId;
  const profileUrl = profileIdentifier ? `https://pew.md/u/${profileIdentifier}` : null;

  // ---------------------------------------------------------------------------
  // Save settings
  // ---------------------------------------------------------------------------

  const handleSaveSettings = async () => {
    setSaving(true);
    setSaveMessage(null);

    try {
      const body: Record<string, unknown> = {};
      if (nickname !== (settings?.nickname ?? "")) {
        body.nickname = nickname || null;
      }
      if (slug !== (settings?.slug ?? "")) {
        body.slug = slug || null;
      }
      if (isPublic !== (settings?.is_public ?? false)) {
        body.is_public = isPublic;
      }

      if (Object.keys(body).length === 0) {
        setSaveMessage({ type: "success", text: "No changes to save." });
        setSaving(false);
        return;
      }

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setSyncedSettings(data);
        setIsPublic(data.is_public ?? false);
        void mutateSettings(data, { revalidate: false });
        setSaveMessage({ type: "success", text: "Settings saved." });
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to save settings.",
        });
      }
    } catch {
      setSaveMessage({ type: "error", text: "Network error." });
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete account
  // ---------------------------------------------------------------------------

  const handleDeleteAccount = async () => {
    if (!deleteConfirmEmail.trim()) {
      setDeleteError("Please enter your email to confirm.");
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_email: deleteConfirmEmail }),
      });

      if (res.ok) {
        // Sign out and redirect to home
        await signOut({ callbackUrl: "/" });
      } else {
        const data = await res.json().catch(() => ({}));
        setDeleteError(
          (data as { error?: string }).error ?? "Failed to delete account.",
        );
      }
    } catch {
      setDeleteError("Network error.");
    } finally {
      setDeleting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">General</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Account settings and public profile.
        </p>
      </div>

      {/* Account Section */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
          <User className="h-4 w-4" strokeWidth={1.5} />
          Account
        </h2>
        <div className="rounded-xl bg-secondary p-5">
          <div className="flex items-center gap-4">
            <Avatar className="h-12 w-12">
              {userImage && <AvatarImage src={userImage} alt={userName} />}
              <AvatarFallback className="bg-primary text-primary-foreground">
                {userName[0] ?? "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{userName}</p>
              <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            </div>
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              Google
            </span>
          </div>
        </div>
      </section>

      <Separator />

      {/* Profile Section */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
          <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
          Public Profile
        </h2>
        <div className="rounded-xl bg-secondary p-5 space-y-4">
          {/* Nickname */}
          <div>
            <label htmlFor="nickname" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Leaderboard Nickname
            </label>
            <input
              id="nickname"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={userName}
              maxLength={32}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Displayed on the leaderboard instead of your real name. Leave empty to use your Google name.
            </p>
          </div>

          {/* Slug */}
          <div>
            <label htmlFor="slug" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Profile URL
            </label>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0 rounded-lg border border-border bg-background overflow-hidden flex-1 min-w-0">
                <span className="px-3 py-2 text-sm text-muted-foreground bg-accent/50 border-r border-border shrink-0">
                  pew.md/u/
                </span>
                <input
                  id="slug"
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder={userId ?? "your-slug"}
                  maxLength={32}
                  className="flex-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none bg-transparent min-w-0"
                />
              </div>
              {profileUrl && (
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(profileUrl);
                    setCopiedUrl(true);
                    setTimeout(() => setCopiedUrl(false), 2000);
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                  title="Copy profile URL"
                >
                  {copiedUrl ? (
                    <Check className="h-4 w-4 text-success" strokeWidth={1.5} />
                  ) : (
                    <Copy className="h-4 w-4" strokeWidth={1.5} />
                  )}
                </button>
              )}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Your public profile URL. Lowercase letters, numbers, and hyphens only.
              {!slug && userId && (
                <span className="text-muted-foreground/70"> Using your user ID as default.</span>
              )}
            </p>
          </div>

          {/* Public visibility toggle */}
          <div className="flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              onClick={() => setIsPublic(!isPublic)}
              className={cn(
                "relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                isPublic ? "bg-primary" : "bg-border",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-sm ring-0 transition-transform",
                  isPublic ? "translate-x-4" : "translate-x-0",
                )}
              />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">
                Show my profile publicly
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                When enabled, your profile appears on the leaderboard and is accessible at your public URL.
              </p>
            </div>
          </div>

          {/* Save button */}
          <div className="space-y-3">
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className={cn(
                "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90",
                saving && "opacity-50 cursor-not-allowed",
              )}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <MessageBanner message={saveMessage} />
          </div>
        </div>
      </section>

      <Separator />

      {/* Danger Zone */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-medium text-destructive mb-3">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
          Danger Zone
        </h2>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              Delete Account
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Permanently delete your account and all associated data. This action cannot be undone.
              All your usage records, session history, projects, and team memberships will be removed.
            </p>
          </div>

          <div>
            <label htmlFor="confirm-email" className="block text-xs font-medium text-muted-foreground mb-1.5">
              To confirm, type your email: <span className="font-mono text-foreground">{userEmail}</span>
            </label>
            <input
              id="confirm-email"
              type="email"
              value={deleteConfirmEmail}
              onChange={(e) => setDeleteConfirmEmail(e.target.value)}
              placeholder="your-email@example.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-destructive/20 transition-shadow"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleDeleteAccount}
              disabled={deleting || deleteConfirmEmail.toLowerCase() !== userEmail.toLowerCase()}
              className={cn(
                "rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90",
                (deleting || deleteConfirmEmail.toLowerCase() !== userEmail.toLowerCase()) && "opacity-50 cursor-not-allowed",
              )}
            >
              {deleting ? "Deleting..." : "Delete My Account"}
            </button>
            {deleteError && (
              <span className="text-xs text-destructive">
                {deleteError}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
