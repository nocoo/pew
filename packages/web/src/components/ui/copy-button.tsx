"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@nocoo/basalt/components/button";

/** Copy an existing block or a collection without displaying the text again. */
export function CopyButton({ text, children }: { text: string; children: string }) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const copied = copiedText === text;

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="secondary"
        size="sm"
        icon={copied ? <Check strokeWidth={1.5} /> : <Copy strokeWidth={1.5} />}
        onClick={async () => {
          setFailed(false);
          try {
            await navigator.clipboard.writeText(text);
            setCopiedText(text);
          } catch {
            setCopiedText(null);
            setFailed(true);
          }
        }}
      >
        <span aria-live="polite">{copied ? "Copied" : children}</span>
      </Button>
      {failed && <p role="alert" className="text-xs text-destructive">Could not copy. Try again.</p>}
    </div>
  );
}
