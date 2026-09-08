"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import {
  User,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageBanner, type MessageBannerMsg } from "@/components/ui/message-banner";
import { Separator } from "@/components/ui/separator";
import { Button } from "@nocoo/basalt/components/button";
import { Field } from "@nocoo/basalt/components/field";
import { Input } from "@nocoo/basalt/components/input";
import { ClipboardText } from "@nocoo/basalt/components/clipboard-text";
import { InputGroup } from "@nocoo/basalt/components/input-group";
import { Label } from "@nocoo/basalt/components/label";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Switch } from "@nocoo/basalt/components/switch";

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
      <PageHeader
        title="General"
        description="Account settings and public profile."
      />

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
          <Field
            label="Leaderboard Nickname"
            htmlFor="nickname"
            hint="Displayed on the leaderboard instead of your real name. Leave empty to use your Google name."
          >
            <Input
              id="nickname"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={userName}
              maxLength={32}
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slug">Profile URL</Label>
            <InputGroup>
              <InputGroup.Addon>pew.md/u/</InputGroup.Addon>
              <InputGroup.Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder={userId ?? "your-slug"}
                maxLength={32}
              />
            </InputGroup>
            {profileUrl ? <ClipboardText text={profileUrl} /> : null}
            <p className="text-xs text-basalt-muted-foreground">
              Your public profile URL. Lowercase letters, numbers, and hyphens only.
              {!slug && userId ? " Using your user ID as default." : null}
            </p>
          </div>

          <div className="flex items-start gap-3">
            <Switch
              checked={isPublic}
              onCheckedChange={setIsPublic}
              aria-label="Show my profile publicly"
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">
                Show my profile publicly
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                When enabled, your profile appears on the leaderboard and is accessible at your public URL.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <Button type="button" onClick={handleSaveSettings} disabled={saving} loading={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
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

          <Field
            label={
              <>
                To confirm, type your email:{" "}
                <span className="font-mono text-foreground">{userEmail}</span>
              </>
            }
            htmlFor="confirm-email"
          >
            <Input
              id="confirm-email"
              type="email"
              value={deleteConfirmEmail}
              onChange={(e) => setDeleteConfirmEmail(e.target.value)}
              placeholder="your-email@example.com"
            />
          </Field>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={deleting || deleteConfirmEmail.toLowerCase() !== userEmail.toLowerCase()}
              loading={deleting}
            >
              {deleting ? "Deleting..." : "Delete My Account"}
            </Button>
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
