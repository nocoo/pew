"use client";

import { useState, useEffect, useRef } from "react";
import { Badge } from "@nocoo/basalt/components/badge";
import { Banner } from "@nocoo/basalt/components/banner";
import { Button } from "@nocoo/basalt/components/button";
import { ClipboardText } from "@nocoo/basalt/components/clipboard-text";
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
import {
  Ban,
  Eye,
  Info,
  Monitor,
  RotateCcw,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { sourceLabel } from "@/hooks/use-usage-data";
import { deviceLabel, shortDeviceId, sortRecentActivityRecords, formatRecentActivityRelativeTime } from "@/lib/device-helpers";
import { agentColor } from "@/lib/palette";
import { useDevices } from "@/hooks/use-devices";
import { useUsageData } from "@/hooks/use-usage-data";
import { useRestoreDialogFocus } from "@/lib/restore-dialog-focus";
import { DevicesEmptyState } from "@/components/dashboard/empty-state";
import type { DeviceSummary } from "@pew/core";
import { ConfirmDialog } from "@nocoo/basalt/components/confirm-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nocoo/basalt/components/tooltip";

function SourceBadge({ source }: { source: string }) {
  const color = agentColor(source);
  return (
    <Badge
      className="rounded-full border-0 px-2 py-0.5 text-[11px] font-medium text-white"
      style={{ backgroundColor: color.color }}
    >
      {sourceLabel(source)}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Device Card
// ---------------------------------------------------------------------------

function DeviceCard({
  device,
  onUpdateAlias,
  onDelete,
  onSetRevoked,
}: {
  device: DeviceSummary;
  onUpdateAlias: (alias: string) => Promise<{ success: boolean; error?: string }>;
  onDelete: () => Promise<{ success: boolean; error?: string }>;
  onSetRevoked: (revoked: boolean) => Promise<{ success: boolean; error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const restoreDetailFocus = useRestoreDialogFocus(detailOpen);
  const restoreDeleteFocus = useRestoreDialogFocus(confirmDelete);
  const restoreRevokeFocus = useRestoreDialogFocus(confirmRevoke);
  const deleteSucceededRef = useRef(false);
  const { data: recentUsage, loading: recentLoading, error: recentError } = useUsageData({
    days: 30,
    deviceId: device.device_id,
    granularity: "half-hour",
    enabled: detailOpen,
  });

  const label = deviceLabel(device);
  const isDefault = device.device_id === "default";
  const hasAlias = device.alias !== null;
  const isEmpty = device.total_tokens === 0 && device.first_seen === null;
  const revoked = device.revoked === true;

  const handleDelete = async () => {
    deleteSucceededRef.current = false;
    setDeleting(true);
    setActionError(null);
    const result = await onDelete();
    setDeleting(false);
    if (!result.success) {
      setActionError(result.error ?? "Failed to delete device");
    } else {
      deleteSucceededRef.current = true;
    }
    setConfirmDelete(false);
  };

  const handleSetRevoked = async (nextRevoked: boolean) => {
    setRevoking(true);
    setActionError(null);
    const result = await onSetRevoked(nextRevoked);
    setRevoking(false);
    if (!result.success) {
      setActionError(result.error ?? "Failed to update device status");
    }
    setConfirmRevoke(false);
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
    return formatRecentActivityRelativeTime(iso);
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div data-device-card className="rounded-xl bg-secondary p-4 space-y-3">
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
                <Banner variant="error" size="sm" description={aliasError} />
              )}
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={handleStartEdit}
              className="h-auto px-0 py-0 text-left text-sm font-medium text-foreground hover:bg-transparent hover:text-foreground/80"
              title="Click to rename"
            >
              {hasAlias ? (
                label
              ) : (
                <span className="text-muted-foreground/70 italic">
                  {isDefault ? "Legacy Device" : "Set a name..."}
                </span>
              )}
            </Button>
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
            {revoked && (
              <>
                <span>·</span>
                <Badge variant="destructive" className="rounded-full">Revoked</Badge>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={`${chromeIconClassName} min-h-11 min-w-11`}
                data-device-detail
                aria-label={`View details for ${label}`}
                onClick={() => setDetailOpen(true)}
              >
                <Eye aria-hidden="true" strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">View details</TooltipContent>
          </Tooltip>

          {revoked ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={`${chromeIconClassName} min-h-11 min-w-11`}
                  aria-label={`Restore ${label}`}
                  disabled={revoking}
                  onClick={() => void handleSetRevoked(false)}
                >
                  <RotateCcw aria-hidden="true" strokeWidth={1.5} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Restore device</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={`${chromeIconClassName} min-h-11 min-w-11`}
                  aria-label={`Revoke ${label}`}
                  disabled={revoking}
                  onClick={() => setConfirmRevoke(true)}
                >
                  <Ban aria-hidden="true" strokeWidth={1.5} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Revoke device</TooltipContent>
            </Tooltip>
          )}

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={`${chromeIconClassName} min-h-11 min-w-11`}
                aria-label={`Delete ${label}`}
                disabled={deleting}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden="true" strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Delete device</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Default device info badge */}
      {isDefault && (
        <Banner
          size="sm"
          icon={<Info className="h-3.5 w-3.5" strokeWidth={1.5} />}
          description="Records from CLI versions before device tracking was added."
        />
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
                  <SourceBadge key={s} source={s} />
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

      {actionError && (
        <Banner variant="error" size="sm" description={actionError} />
      )}

      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        onCloseAutoFocus={restoreRevokeFocus}
        onConfirm={() => handleSetRevoked(true)}
        title={`Revoke ${label}`}
        description="New token-usage, accounting, and evidence records tagged with this device will be ignored. Session uploads without a device ID continue to sync and count at the account level. Existing historical data remains visible."
        confirmLabel="Revoke"
        cancelLabel="Cancel"
        variant="destructive"
        loading={revoking}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!deleteSucceededRef.current) restoreDeleteFocus(event);
        }}
        onConfirm={handleDelete}
        title={`Delete ${label}`}
        description="Remove this device record only. Historical usage, sessions and rankings remain unchanged."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        loading={deleting}
      />

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent size="base" onCloseAutoFocus={restoreDetailFocus}>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`absolute top-4 right-4 ${chromeIconClassName}`}
              aria-label="Close details"
            >
              <X aria-hidden="true" strokeWidth={1.5} />
            </Button>
          </DialogClose>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              Recent usage from this device over the last 30 days.
            </DialogDescription>
          </DialogHeader>

          {revoked && (
            <Badge variant="destructive" className="w-fit rounded-full">Revoked</Badge>
          )}

          <h3 className="text-sm font-medium text-basalt-foreground">Recent activity</h3>

          {recentLoading ? (
            <p className="text-sm text-basalt-muted-foreground">Loading recent activity...</p>
          ) : recentError ? (
            <Banner variant="error" size="sm" description="Failed to load recent device activity" />
          ) : recentUsage?.records.length ? (
            <div className="space-y-2">
              {sortRecentActivityRecords(recentUsage.records)
                .slice(0, 10)
                .map((record) => (
                  <div
                    key={`${record.source}:${record.model}:${record.hour_start}`}
                    className="flex items-start justify-between gap-3 rounded-lg bg-basalt-secondary px-3 py-2.5"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SourceBadge source={record.source} />
                        <span className="truncate text-xs font-mono text-basalt-foreground">{record.model}</span>
                      </div>
                      <p className="text-xs text-basalt-muted-foreground">
                        {record.hour_start ? relativeTime(record.hour_start) : "Recent"}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-basalt-foreground">
                      {formatTokens(record.total_tokens)}
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-sm text-basalt-muted-foreground">No recent activity</p>
          )}
        </DialogContent>
      </Dialog>
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
              <ClipboardText text={authCode} className="w-full" />

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
  const { data, loading, error, updateAlias, deleteDevice, setRevoked } = useDevices();
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

  const deleteDeviceWithFocus = async (deviceId: string, index: number) => {
    const result = await deleteDevice(deviceId);
    if (result.success) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-device-card]"));
          const targetIndex = Math.min(index, cards.length - 1);
          const survivingDetail = targetIndex >= 0
            ? cards[targetIndex]?.querySelector<HTMLElement>("[data-device-detail]")
            : null;
          if (survivingDetail) {
            survivingDetail.focus();
            return;
          }
          document.querySelector<HTMLElement>('button[aria-label="CLI Login Code"]')?.focus();
        });
      });
    }
    return result;
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Devices"
        description="Manage your synced devices and set aliases."
        actions={
          <Button variant="outline" size="sm" aria-label="CLI Login Code" onClick={() => setShowAuthCodeModal(true)}>
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
        <Banner variant="error" description={error} />
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
            {devices.map((device, index) => (
              <DeviceCard
                key={device.device_id}
                device={device}
                onUpdateAlias={(alias) =>
                  updateAlias(device.device_id, alias)
                }
                onDelete={() => deleteDeviceWithFocus(device.device_id, index)}
                onSetRevoked={(revoked) => setRevoked(device.device_id, revoked)}
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
