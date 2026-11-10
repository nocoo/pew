"use client";

import type { ReactElement } from "react";
import { Button } from "@nocoo/basalt/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nocoo/basalt/components/tooltip";
import { Hexly } from "@/components/icons/hexly";

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
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" asChild>
          <a
            href="https://hexly.ai/projects/pew"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Pew on hexly.ai (opens in a new tab)"
          >
            <Hexly aria-hidden="true" strokeWidth={1.5} />
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Pew on hexly.ai</TooltipContent>
    </Tooltip>
  );
}
