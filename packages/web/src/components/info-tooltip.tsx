"use client";

import { useState, type ReactNode } from "react";
import { Info } from "@nocoo/basalt/icons";
import { Button } from "@nocoo/basalt/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nocoo/basalt/components/tooltip";

export function InfoTooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Tooltip open={open} onOpenChange={setOpen} delayDuration={0}>
    <TooltipTrigger asChild onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => { event.preventDefault(); event.currentTarget.focus(); setOpen(true); }}>
      <Button type="button" variant="ghost" size="icon" aria-label={label} className="h-8 w-8 shrink-0 text-basalt-muted-foreground">
        <Info className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom" align="end" collisionPadding={16}
      className="max-h-[calc(100dvh-2rem)] w-80 max-w-[calc(100vw-2rem)] space-y-2 overflow-y-auto p-3 text-xs leading-relaxed">
      {children}
    </TooltipContent>
  </Tooltip>;
}
