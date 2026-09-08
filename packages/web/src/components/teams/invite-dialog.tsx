"use client";

import { useState, useCallback } from "react";
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
import { UserPlus, X } from "lucide-react";
import { chromeIconClassName } from "@/lib/ghost-icon";
import { useRestoreDialogFocus } from "@/lib/restore-dialog-focus";

export interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamName: string;
  inviteCode: string;
}

export function InviteDialog({
  open,
  onOpenChange,
  teamName,
  inviteCode,
}: InviteDialogProps) {
  const restoreFocus = useRestoreDialogFocus(open);
  const inviteMessage = `Join my team "${teamName}" on pew!

How to join:
1. Go to pew.md and sign in
2. Navigate to Teams
3. Click "Join Team"
4. Enter invite code: ${inviteCode}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={restoreFocus}>
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
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-basalt-primary/10 text-basalt-primary">
          <UserPlus className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <DialogHeader className="text-center">
          <DialogTitle className="text-center text-lg">Invite Members</DialogTitle>
          <DialogDescription className="text-center text-sm">
            Share the invite code or copy the message below to invite teammates.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 mb-4">
          <span className="mb-2 block text-xs font-medium text-basalt-muted-foreground">
            Invite Code
          </span>
          <ClipboardText text={inviteCode} />
        </div>

        <div className="mb-2">
          <span className="mb-2 block text-xs font-medium text-basalt-muted-foreground">
            Invite Message
          </span>
          <div className="rounded-lg bg-basalt-accent/50 p-4 ring-1 ring-basalt-border">
            <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap text-basalt-foreground">
              {inviteMessage}
            </pre>
          </div>
          <div className="mt-3">
            <ClipboardText text={inviteMessage} className="w-full max-w-full" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface UseInviteDialogReturn {
  openInviteDialog: (teamName: string, inviteCode: string) => void;
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
