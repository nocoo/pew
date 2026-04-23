"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, X, Check, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";
import type { DbPricingRow } from "@/lib/pricing";
import {
  type PricingFormData as FormData,
  EMPTY_PRICING_FORM as EMPTY_FORM,
  rowToForm,
  validatePricingForm as validateForm,
} from "@/lib/pricing-form-helpers";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function PricingSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-secondary p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-4 w-48" />
            <div className="flex-1" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminPricingPage() {
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdmin();

  const [rows, setRows] = useState<DbPricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Inline editing
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<FormData>(EMPTY_FORM);

  // Inline creation
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const { confirm, dialogProps } = useConfirm();

  // ---------------------------------------------------------------------------
  // Redirect non-admins
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      router.replace("/");
    }
  }, [adminLoading, isAdmin, router]);

  // ---------------------------------------------------------------------------
  // Fetch rows
  // ---------------------------------------------------------------------------

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/pricing");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as { rows: DbPricingRow[] };
      setRows(json.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchRows();
  }, [isAdmin, fetchRows]);

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  const handleCreate = async () => {
    const validationError = validateForm(createForm);
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const body: Record<string, unknown> = {
        model: createForm.model.trim(),
        input: parseFloat(createForm.input),
        output: parseFloat(createForm.output),
      };
      if (createForm.cached.trim()) body.cached = parseFloat(createForm.cached);
      if (createForm.source.trim()) body.source = createForm.source.trim();
      if (createForm.note.trim()) body.note = createForm.note.trim();

      const res = await fetch("/api/admin/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      setCreateForm(EMPTY_FORM);
      setShowCreate(false);
      setMessage({ type: "success", text: "Pricing entry created." });
      fetchRows();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to create." });
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  const handleUpdate = async () => {
    if (editingId == null) return;

    const validationError = validateForm(editForm);
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const body: Record<string, unknown> = {
        id: editingId,
        model: editForm.model.trim(),
        input: parseFloat(editForm.input),
        output: parseFloat(editForm.output),
        cached: editForm.cached.trim() ? parseFloat(editForm.cached) : null,
        source: editForm.source.trim() || null,
        note: editForm.note.trim() || null,
      };

      const res = await fetch("/api/admin/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      setEditingId(null);
      setMessage({ type: "success", text: "Pricing entry updated." });
      fetchRows();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to update." });
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: "Delete pricing entry?",
      description: "This pricing override will be removed. The default pricing will apply.",
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!confirmed) return;
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/pricing?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setMessage({ type: "success", text: "Pricing entry deleted." });
      fetchRows();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to delete." });
    }
  };

  // ---------------------------------------------------------------------------
  // Guard: loading or not admin
  // ---------------------------------------------------------------------------

  if (adminLoading) {
    return (
      <div className="space-y-4 md:space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80 mt-2" />
        </div>
        <PricingSkeleton />
      </div>
    );
  }

  if (!isAdmin) return null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Token Pricing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage model pricing overrides (USD per 1M tokens). DB entries override static defaults.
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreate(!showCreate);
            setEditingId(null);
            setCreateForm(EMPTY_FORM);
          }}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Add Entry
        </button>
      </div>

      {/* Messages */}
      {message && (
        <div
          className={cn(
            "rounded-lg p-3 text-xs",
            message.type === "success"
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {message.text}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-card bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load pricing data: {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl bg-secondary p-4">
          <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
            <DollarSign className="h-4 w-4" strokeWidth={1.5} />
            New Pricing Entry
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FormField
              label="Model *"
              value={createForm.model}
              onChange={(v) => setCreateForm({ ...createForm, model: v })}
              placeholder="claude-sonnet-4-20250514"
              mono
            />
            <FormField
              label="Input ($/1M)"
              value={createForm.input}
              onChange={(v) => setCreateForm({ ...createForm, input: v })}
              placeholder="3.00"
              type="number"
            />
            <FormField
              label="Output ($/1M)"
              value={createForm.output}
              onChange={(v) => setCreateForm({ ...createForm, output: v })}
              placeholder="15.00"
              type="number"
            />
            <FormField
              label="Cached ($/1M)"
              value={createForm.cached}
              onChange={(v) => setCreateForm({ ...createForm, cached: v })}
              placeholder="0.30 (optional)"
              type="number"
            />
            <FormField
              label="Source"
              value={createForm.source}
              onChange={(v) => setCreateForm({ ...createForm, source: v })}
              placeholder="claude-code (optional)"
              mono
            />
            <FormField
              label="Note"
              value={createForm.note}
              onChange={(v) => setCreateForm({ ...createForm, note: v })}
              placeholder="Optional note"
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleCreate}
              disabled={saving}
              className={cn(
                "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
                saving && "opacity-50 cursor-not-allowed",
              )}
            >
              {saving ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => {
                setShowCreate(false);
                setCreateForm(EMPTY_FORM);
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && <PricingSkeleton />}

      {/* Table */}
      {!loading && (
        <>
          {rows.length === 0 ? (
            <div className="rounded-card bg-secondary p-8 text-center text-sm text-muted-foreground">
              No pricing overrides in database. Static defaults are used for all models.
            </div>
          ) : (
            <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Model</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">Source</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Input</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Output</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden md:table-cell">Cached</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden lg:table-cell">Note</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) =>
                    editingId === row.id ? (
                      <tr key={row.id} className="border-b border-border/50 last:border-0 bg-accent/30">
                        <td className="px-3 py-2">
                          <input
                            value={editForm.model}
                            onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                            className="w-full rounded border border-border bg-background px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                        </td>
                        <td className="px-3 py-2 hidden sm:table-cell">
                          <input
                            value={editForm.source}
                            onChange={(e) => setEditForm({ ...editForm, source: e.target.value })}
                            className="w-full rounded border border-border bg-background px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
                            placeholder="(any)"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={editForm.input}
                            onChange={(e) => setEditForm({ ...editForm, input: e.target.value })}
                            type="number"
                            step="0.01"
                            className="w-20 rounded border border-border bg-background px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={editForm.output}
                            onChange={(e) => setEditForm({ ...editForm, output: e.target.value })}
                            type="number"
                            step="0.01"
                            className="w-20 rounded border border-border bg-background px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                        </td>
                        <td className="px-3 py-2 hidden md:table-cell">
                          <input
                            value={editForm.cached}
                            onChange={(e) => setEditForm({ ...editForm, cached: e.target.value })}
                            type="number"
                            step="0.01"
                            className="w-20 rounded border border-border bg-background px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20"
                            placeholder="auto"
                          />
                        </td>
                        <td className="px-3 py-2 hidden lg:table-cell">
                          <input
                            value={editForm.note}
                            onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                            className="w-full rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                            placeholder="(none)"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={handleUpdate}
                              disabled={saving}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-success hover:bg-success/10 transition-colors"
                              title="Save"
                            >
                              <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                              title="Cancel"
                            >
                              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={row.id}
                        className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span className="text-sm font-mono font-medium text-foreground">{row.model}</span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          {row.source ? (
                            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {row.source}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">any</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums">${row.input}</td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums">${row.output}</td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums hidden md:table-cell">
                          {row.cached != null ? `$${row.cached}` : <span className="text-muted-foreground/50">auto</span>}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-xs text-muted-foreground truncate max-w-[200px] block">
                            {row.note ?? ""}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => {
                                setEditingId(row.id);
                                setEditForm(rowToForm(row));
                                setShowCreate(false);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                            <button
                              onClick={() => handleDelete(row.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Info about static defaults */}
          <div className="rounded-lg bg-accent/50 p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">How pricing works</p>
            <p>
              Static defaults are built into the app for common models. Database entries here override
              or extend the defaults. Resolution order: exact model match &rarr; prefix match &rarr;
              source default &rarr; global fallback ($3/$15 per 1M tokens).
            </p>
          </div>
        </>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form field helper
// ---------------------------------------------------------------------------

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        step={type === "number" ? "0.01" : undefined}
        className={cn(
          "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow",
          mono && "font-mono",
        )}
      />
    </div>
  );
}
