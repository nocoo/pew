"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@nocoo/basalt/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@nocoo/basalt/components/dialog";
import { chromeIconClassName } from "@/lib/ghost-icon";
import { Input } from "@nocoo/basalt/components/input";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Monitor, Info, Trash2, Terminal, Copy, Check, X } from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { sourceLabel } from "@/hooks/use-usage-data";
import { deviceLabel, shortDeviceId } from "@/lib/device-helpers";
import { useDevices } from "@/hooks/use-devices";
import { useRestoreDialogFocus } from "@/lib/restore-dialog-focus";
import { DevicesEmptyState } from "@/components/dashboard/empty-state";
import type { DeviceSummary } from "@pew/core";

// ---------------------------------------------------------------------------
// Device Card
// ---------------------------------------------------------------------------

function DeviceCard({
  device,
  onUpdateAlias,
  onDelete,
}: {
  device: DeviceSummary;
  onUpdateAlias: (alias: string) => Promise<{ success: boolean; error?: string }>;
  onDelete?: (() => Promise<{ success: boolean; error?: string }>) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const label = deviceLabel(device);
  const isDefault = device.device_id === "default";
  const hasAlias = device.alias !== null;
  const isEmpty = device.total_tokens === 0 && device.first_seen === null;

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    const result = await onDelete();
    setDeleting(false);
    if (!result.success) {
      setAliasError(result.error ?? "Failed to delete");
    }
    setConfirmDelete(false);
  };

  const handleStartEdit = () => {
    setEditValue(device.alias ?? "");
    setAliasError(null);
    setEditing(true);
  };

  const handleSave = async () => {
    const trimmed = editValue.trim();
    // If empty or unchanged, just cancel
    if (!trimmed || trimmed === device.alias) {
      setEditing(false);
      setAliasError(null);
      return;
    }

    setSaving(true);
    setAliasError(null);
    const result = await onUpdateAlias(trimmed);
    setSaving(false);

    if (result.success) {
      setEditing(false);
    } else {
      setAliasError(result.error ?? "Failed to save");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      setEditing(false);
      setAliasError(null);
    }
  };

  function relativeTime(iso: string): string {
    // NOTE: react-hooks/purity had no biome equivalent, monitored via review.
    // Date.now() for relative time display is intentionally impure.
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="rounded-xl bg-secondary p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-1">
              <Input
                type="text"
                size="sm"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                maxLength={50}
                disabled={saving}
                placeholder={isDefault ? "Legacy Device" : shortDeviceId(device.device_id)}
                className={cn("w-full max-w-xs", aliasError && "ring-basalt-danger", saving && "opacity-50")}
              />
              {aliasError && (
                <p className="text-[11px] text-destructive">{aliasError}</p>
              )}
            </div>
          ) : (
            <button type="button"
              onClick={handleStartEdit}
              className="text-sm font-medium text-foreground hover:text-foreground/80 transition-colors text-left"
              title="Click to rename"
            >
              {hasAlias ? (
                label
              ) : (
                <span className="text-muted-foreground/70 italic">
                  {isDefault ? "Legacy Device" : "Set a name..."}
                </span>
              )}
            </button>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
            <span className="font-mono text-[10px] text-muted-foreground/60">
              {isDefault ? "default" : shortDeviceId(device.device_id)}
            </span>
            {device.first_seen && (
              <>
                <span>·</span>
                <span>First seen {fmtDate(device.first_seen)}</span>
              </>
            )}
            {device.last_seen && (
              <>
                <span>·</span>
                <span>Last seen {relativeTime(device.last_seen)}</span>
              </>
            )}
            {isEmpty && (
              <>
                <span>·</span>
                <span className="italic">No usage data</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Default device info badge */}
      {isDefault && (
        <div className="flex items-start gap-2 rounded-lg bg-accent/50 px-3 py-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.5} />
          <p className="text-[11px] text-muted-foreground">
            Records from CLI versions before device tracking was added.
          </p>
        </div>
      )}

      {/* Stats row */}
      {!isEmpty && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* Tools */}
          {device.sources.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Tools:</span>
              <div className="flex gap-1">
                {device.sources.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {sourceLabel(s)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <span className="text-xs text-muted-foreground">
            {device.model_count} {device.model_count === 1 ? "model" : "models"}
          </span>

          <span className="text-xs text-muted-foreground">
            {formatTokens(device.total_tokens)} tokens
          </span>
        </div>
      )}

      {/* Delete button for empty devices */}
      {isEmpty && onDelete && (
        <div className="flex items-center gap-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete this device?</span>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
                loading={deleting}
              >
                {deleting ? "Deleting..." : "Confirm"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3 w-3" strokeWidth={1.5} />
              Delete
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth Code Modal
// ---------------------------------------------------------------------------

function AuthCodeModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [authCode, setAuthCode] = useState<string | null>(null);
  const [authCodeExpiresAt, setAuthCodeExpiresAt] = useState<Date | null>(null);
  const [authCodeRemaining, setAuthCodeRemaining] = useState<number>(0);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restoreFocus = useRestoreDialogFocus(open);

  // Reset state when modal closes — render-time update pattern.
  // (The countdown interval is cleaned up by the useEffect below when
  // authCodeExpiresAt becomes null.)
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setAuthCode(null);
      setAuthCodeExpiresAt(null);
      setAuthCodeRemaining(0);
      setCopiedCode(false);
    }
  }

  // Countdown timer for auth code
  useEffect(() => {
    if (!authCodeExpiresAt) return;

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.floor((authCodeExpiresAt.getTime() - Date.now()) / 1000));
      setAuthCodeRemaining(remaining);
      if (remaining === 0) {
        setAuthCode(null);
        setAuthCodeExpiresAt(null);
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      }
    };

    updateRemaining();
    countdownRef.current = setInterval(updateRemaining, 1000);

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [authCodeExpiresAt]);

  const handleGenerateAuthCode = async () => {
    setGeneratingCode(true);
    setCopiedCode(false);

    try {
      const res = await fetch("/api/auth/code", {
        method: "POST",
      });

      if (res.ok) {
        const data = await res.json();
        setAuthCode(data.code);
        setAuthCodeExpiresAt(new Date(data.expires_at));
      }
    } catch {
      // Silently fail
    } finally {
      setGeneratingCode(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" onCloseAutoFocus={restoreFocus}>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`absolute top-4 right-4 ${chromeIconClassName}`}
              aria-label="Close"
            >
              <X aria-hidden="true" strokeWidth={1.5} />
            </Button>
          </DialogClose>
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-basalt-primary/10">
                <Terminal className="h-4 w-4 text-basalt-primary" strokeWidth={1.5} />
              </div>
              <DialogTitle className="text-base">CLI Login Code</DialogTitle>
            </div>
            <DialogDescription>
              Generate a one-time code to authenticate the pew CLI on a headless machine (no browser).
            </DialogDescription>
          </DialogHeader>

          {authCode ? (
            <div className="space-y-4">
              {/* Code display */}
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg bg-secondary border border-border px-4 py-3">
                  <code className="block text-center font-mono text-xl font-bold tracking-[0.2em] text-foreground">
                    {authCode}
                  </code>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 shrink-0"
                  onClick={async () => {
                    await navigator.clipboard.writeText(authCode);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 2000);
                  }}
                  aria-label="Copy code"
                >
                  {copiedCode ? (
                    <Check className="h-4 w-4" strokeWidth={2} />
                  ) : (
                    <Copy className="h-4 w-4" strokeWidth={1.5} />
                  )}
                </Button>
              </div>

              {/* Expiry countdown */}
              <div className="flex items-center justify-center gap-2 text-sm">
                <span className="text-muted-foreground">Expires in</span>
                <span className={cn(
                  "font-mono font-semibold tabular-nums",
                  authCodeRemaining <= 60 ? "text-destructive" : "text-foreground"
                )}>
                  {Math.floor(authCodeRemaining / 60)}:{String(authCodeRemaining % 60).padStart(2, "0")}
                </span>
              </div>

              {/* Command preview */}
              <div className="rounded-lg bg-secondary/50 border border-border/50 p-3">
                <p className="text-[11px] text-muted-foreground mb-1.5">Run on your machine:</p>
                <code className="block text-sm font-mono text-foreground">
                  pew login --code {authCode}
                </code>
              </div>

              {/* Regenerate button */}
              <Button
                variant="outline"
                className="w-full"
                onClick={handleGenerateAuthCode}
                disabled={generatingCode}
                loading={generatingCode}
              >
                Generate New Code
              </Button>
            </div>
          ) : (
            <Button
              className="w-full"
              onClick={handleGenerateAuthCode}
              disabled={generatingCode}
              loading={generatingCode}
            >
              Generate Code
            </Button>
          )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ManageDevicesPage() {
  const { data, loading, error, updateAlias, deleteDevice } = useDevices();
  const [showAuthCodeModal, setShowAuthCodeModal] = useState(false);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="space-y-8">
        <PageHeader title="Devices" description="Loading device data..." />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 rounded-xl bg-secondary animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  const devices = data?.devices ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Devices"
        description="Manage your synced devices and set aliases."
        actions={
          <Button variant="outline" size="sm" onClick={() => setShowAuthCodeModal(true)}>
            <Terminal className="h-3.5 w-3.5" strokeWidth={1.5} />
            CLI Login Code
          </Button>
        }
      />

      {/* Auth Code Modal */}
      <AuthCodeModal
        open={showAuthCodeModal}
        onOpenChange={setShowAuthCodeModal}
      />

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Empty state */}
      {devices.length === 0 && (
        <DevicesEmptyState />
      )}

      {/* Device list */}
      {devices.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Monitor className="h-4 w-4" strokeWidth={1.5} />
              Your Devices
              <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {devices.length}
              </span>
            </h2>
          </div>

          <div className="space-y-2">
            {devices.map((device) => (
              <DeviceCard
                key={device.device_id}
                device={device}
                onUpdateAlias={(alias) =>
                  updateAlias(device.device_id, alias)
                }
                onDelete={
                  device.total_tokens === 0 && device.first_seen === null
                    ? () => deleteDevice(device.device_id)
                    : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Footer info */}
      {devices.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-accent/30 px-4 py-3">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.5} />
          <p className="text-xs text-muted-foreground">
            Device IDs are auto-generated per machine when you first run{" "}
            <code className="font-mono text-[11px]">pew sync</code>.
          </p>
        </div>
      )}
    </div>
  );
}
