import { Collapsible as CollapsiblePrimitive } from "radix-ui";

const Collapsible = CollapsiblePrimitive.Root;
const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
// CollapsibleContent alias removed 2026-07-08 (G1 cleanup): had no consumers.
// Restore by adding `CollapsiblePrimitive.Content` here if needed.

export { Collapsible, CollapsibleTrigger };
