"use client";

import { useState } from "react";
import { Monitor, Info, Trash2 } from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { sourceLabel } from "@/hooks/use-usage-data";
import { deviceLabel, shortDeviceId } from "@/lib/device-helpers";
import { useDevices } from "@/hooks/use-devices";
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
    // eslint-disable-next-line react-hooks/purity -- Date.now() for relative time display is intentionally impure
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
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                maxLength={50}
                autoFocus
                disabled={saving}
                placeholder={isDefault ? "Legacy Device" : shortDeviceId(device.device_id)}
                className={cn(
                  "w-full max-w-xs rounded-lg border bg-background px-2 py-1 text-sm font-medium text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow",
                  aliasError ? "border-destructive" : "border-border",
                  saving && "opacity-50"
                )}
              />
              {aliasError && (
                <p className="text-[11px] text-destructive">{aliasError}</p>
              )}
            </div>
          ) : (
            <button
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
              <button
                onClick={handleDelete}
                disabled={deleting}
                className={cn(
                  "rounded-lg bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors",
                  deleting && "opacity-50"
                )}
              >
                {deleting ? "Deleting..." : "Confirm"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-3 w-3" strokeWidth={1.5} />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ManageDevicesPage() {
  const { data, loading, error, updateAlias, deleteDevice } = useDevices();

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold font-display">Devices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Loading device data...
          </p>
        </div>
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
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display">Devices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your synced devices and set aliases.
        </p>
      </div>

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
