"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  User,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserSettings {
  nickname: string | null;
  slug: string | null;
}

// ---------------------------------------------------------------------------
// Settings Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { data: session } = useSession();

  // User settings state
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [nickname, setNickname] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";
  const userImage = session?.user?.image;

  // ---------------------------------------------------------------------------
  // Fetch settings
  // ---------------------------------------------------------------------------

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setNickname(data.nickname ?? "");
        setSlug(data.slug ?? "");
      }
    } catch {
      // Silently fail on initial load
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

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
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display">General</h1>
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
            <div className="flex items-center gap-0 rounded-lg border border-border bg-background overflow-hidden">
              <span className="px-3 py-2 text-sm text-muted-foreground bg-accent/50 border-r border-border shrink-0">
                pew.dev/u/
              </span>
              <input
                id="slug"
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="your-slug"
                maxLength={32}
                className="flex-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none bg-transparent min-w-0"
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Your public profile URL. Lowercase letters, numbers, and hyphens only.
            </p>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3">
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
            {saveMessage && (
              <span
                className={cn(
                  "text-xs",
                  saveMessage.type === "success"
                    ? "text-success"
                    : "text-destructive",
                )}
              >
                {saveMessage.text}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
