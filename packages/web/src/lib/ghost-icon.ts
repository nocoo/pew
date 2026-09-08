/** Pair with Basalt `Button variant="ghost" size="icon"`. */
export const ghostIconClassName =
  "text-basalt-muted-foreground hover:text-basalt-foreground";

/** Header / public chrome cluster (privacy, github, theme). */
export const chromeIconClassName = `${ghostIconClassName} h-8 w-8 [&_svg]:size-[18px]`;

/** Compact toolbar and table row actions. */
export const rowIconClassName = `${ghostIconClassName} h-7 w-7 hover:bg-basalt-accent [&_svg]:size-3.5`;

/** Destructive row action (delete). */
export const rowIconDangerClassName =
  "h-7 w-7 text-basalt-muted-foreground hover:bg-basalt-destructive/10 hover:text-basalt-destructive [&_svg]:size-3.5";
