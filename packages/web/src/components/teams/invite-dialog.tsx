"use client";

import { useState, useCallback } from "react";
import { Button } from "@nocoo/basalt/components/button";
import { ClipboardText } from "@nocoo/basalt/components/clipboard-text";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@nocoo/basalt/components/dialog";
import { UserPlus } from "lucide-react";

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
  const inviteMessage = `Join my team "${teamName}" on pew!

How to join:
1. Go to pew.md and sign in
2. Navigate to Teams
3. Click "Join Team"
4. Enter invite code: ${inviteCode}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
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
          <div className="mt-3 flex justify-end">
            <CopyMessageButton text={inviteMessage} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant={copied ? "secondary" : "default"}
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied!" : "Copy Message"}
    </Button>
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
