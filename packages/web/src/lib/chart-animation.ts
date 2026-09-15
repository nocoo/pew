import type { AnimationController, CancelableTimeout } from "recharts";

/** Shared by every data series and the CSS charts; `auto` honors reduced motion. */
export const CHART_ANIMATION = {
  isAnimationActive: "auto",
  animationBegin: 0,
  animationDuration: 500,
  animationEasing: "ease-out",
} as const;

/** Keep Recharts' native scheduler, but exclude sidebar motion from its clock. */
export function createChartAnimationController() {
  let paused = false;
  const jobs = new Set<{ pause(): void; resume(): void }>();

  const controller: AnimationController = (clock, animation, listener) => {
    let cancel: CancelableTimeout | undefined;
    let previous: number | undefined;
    let elapsed = 0;

    const update = (now: number) => {
      elapsed += previous === undefined ? 0 : now - previous;
      previous = now;
      const delay = animation.tick(elapsed);
      if (animation.getState() === "active") {
        listener(animation.getInterpolated());
        if (animation.getProgress() === 1) {
          jobs.delete(job);
          cancel = undefined;
          animation.complete();
          return;
        }
      }
      cancel = clock.setTimeout(update, delay);
    };

    const job = {
      pause() {
        cancel?.();
        cancel = undefined;
        previous = undefined;
      },
      resume() {
        cancel = clock.setTimeout(update, 0);
      },
    };
    jobs.add(job);
    if (!paused) job.resume();
    return () => {
      job.pause();
      jobs.delete(job);
    };
  };

  return {
    controller,
    pause() {
      if (paused) return;
      paused = true;
      for (const job of jobs) job.pause();
    },
    resume() {
      if (!paused) return;
      paused = false;
      for (const job of jobs) job.resume();
    },
  };
}
