"use client";

import { useState, useCallback } from "react";
import { Dialog } from "radix-ui";
import { Copy, Check, X, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InviteDialogProps {
  /** Dialog open state */
  open: boolean;
  /** Handler called when dialog should close */
  onOpenChange: (open: boolean) => void;
  /** Team name for the invite message */
  teamName: string;
  /** The invite code to share */
  inviteCode: string;
}

// ---------------------------------------------------------------------------
// CopyButton (internal)
// ---------------------------------------------------------------------------

function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        copied
          ? "bg-success/10 text-success"
          : "bg-primary text-primary-foreground hover:bg-primary/90",
        className
      )}
    >
      {copied ? (
        <>
          <Check className="h-4 w-4" strokeWidth={1.5} />
          {label ? "Copied!" : null}
        </>
      ) : (
        <>
          <Copy className="h-4 w-4" strokeWidth={1.5} />
          {label}
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// InviteDialog
// ---------------------------------------------------------------------------

export function InviteDialog({
  open,
  onOpenChange,
  teamName,
  inviteCode,
}: InviteDialogProps) {
  const inviteMessage = `Join my team "${teamName}" on pew!

How to join:
1. Go to pew.dev and sign in
2. Navigate to Teams
3. Click "Join Team"
4. Enter invite code: ${inviteCode}`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card p-6 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          {/* Close button */}
          <Dialog.Close asChild>
            <button
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>

          {/* Icon */}
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
            <UserPlus className="h-6 w-6" strokeWidth={1.5} />
          </div>

          {/* Title */}
          <Dialog.Title className="text-center text-lg font-semibold text-foreground mb-2">
            Invite Members
          </Dialog.Title>

          {/* Description */}
          <Dialog.Description className="text-center text-sm text-muted-foreground mb-6">
            Share the invite code or copy the message below to invite teammates.
          </Dialog.Description>

          {/* Invite Code */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Invite Code
            </label>
            <div className="flex items-center gap-2 rounded-lg bg-accent/50 border border-border px-4 py-3">
              <code className="flex-1 font-mono text-sm text-foreground tracking-wider">
                {inviteCode}
              </code>
              <CopyButton text={inviteCode} />
            </div>
          </div>

          {/* Invite Message */}
          <div className="mb-6">
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Invite Message
            </label>
            <div className="rounded-lg bg-accent/50 border border-border p-4">
              <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
                {inviteMessage}
              </pre>
            </div>
            <div className="mt-3 flex justify-end">
              <CopyButton text={inviteMessage} label="Copy Message" />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Hook for easier usage
// ---------------------------------------------------------------------------

export interface UseInviteDialogReturn {
  /** Open the invite dialog */
  openInviteDialog: (teamName: string, inviteCode: string) => void;
  /** Props to spread on InviteDialog */
  dialogProps: InviteDialogProps;
}

export function useInviteDialog(): UseInviteDialogReturn {
  const [state, setState] = useState({
    open: false,
    teamName: "",
    inviteCode: "",
  });

  const openInviteDialog = useCallback((teamName: string, inviteCode: string) => {
    setState({ open: true, teamName, inviteCode });
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setState((prev) => ({ ...prev, open: false }));
    }
  }, []);

  return {
    openInviteDialog,
    dialogProps: {
      open: state.open,
      onOpenChange: handleOpenChange,
      teamName: state.teamName,
      inviteCode: state.inviteCode,
    },
  };
}
