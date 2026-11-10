"use client";

import { Button } from "@nocoo/basalt/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nocoo/basalt/components/tooltip";
import { useTheme } from "@nocoo/basalt/providers/theme";
import { Monitor, Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const label = nextTheme === "system" ? "Use system theme" : `Switch to ${nextTheme} theme`;
  const Icon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(nextTheme)}
          aria-label="Toggle theme"
        >
          <Icon aria-hidden="true" strokeWidth={1.5} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
