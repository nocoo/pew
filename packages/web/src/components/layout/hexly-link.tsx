"use client";

import type { ReactElement } from "react";
import { Button } from "@nocoo/basalt/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nocoo/basalt/components/tooltip";
import { Hexly } from "@/components/icons/hexly";
import { chromeIconClassName } from "@/lib/ghost-icon";

export function HeaderTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function HexlyLink() {
  return (
    <HeaderTooltip label="Pew on hexly.ai">
      <Button variant="ghost" size="icon" className={chromeIconClassName} asChild>
        <a
          href="https://hexly.ai/projects/pew"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Pew on hexly.ai (opens in a new tab)"
        >
          <Hexly aria-hidden="true" strokeWidth={1.5} />
        </a>
      </Button>
    </HeaderTooltip>
  );
}
