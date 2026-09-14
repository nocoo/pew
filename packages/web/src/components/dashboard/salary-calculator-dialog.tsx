"use client";

import { Calculator, X } from "lucide-react";
import { Button } from "@nocoo/basalt/components/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@nocoo/basalt/components/dialog";
import type { OverviewDay } from "@/lib/overview-helpers";
import { SalaryEstimator } from "./salary-estimator-card";

export function SalaryCalculatorDialog({ daily, dailyAverageCost, rangeLabel, incomplete, disabled }: {
  daily: OverviewDay[];
  dailyAverageCost: number;
  rangeLabel: string;
  incomplete: boolean;
  disabled: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} aria-label="Salary calculator">
          <Calculator className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
          Salary calculator
        </Button>
      </DialogTrigger>
      <DialogContent size="xl" className="sm:w-[72rem] p-4 sm:p-7">
        <div className="mb-6 flex items-start justify-between gap-3">
          <DialogHeader>
            <DialogTitle>Salary calculator</DialogTitle>
            <DialogDescription className="text-sm">
              {rangeLabel} · {daily.length} calendar days. Explore a salary equivalent from your estimated token spend.
            </DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close salary calculator" className="shrink-0">
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>
        {incomplete && <p className="mb-4 text-xs text-muted-foreground">The underlying public-price estimate includes assumptions where cache or pricing details are unavailable.</p>}
        <SalaryEstimator
          rangeLabel={rangeLabel} dailyAverageCost={dailyAverageCost}
          dailyCosts={daily.map((day) => ({ date: day.date, totalCost: day.cost }))}
        />
      </DialogContent>
    </Dialog>
  );
}
