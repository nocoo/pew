import { JavascriptAnimation, type TimeoutController } from "recharts";
import { describe, expect, it, vi } from "vitest";
import { CHART_ANIMATION, createChartAnimationController } from "./chart-animation";

function frameClock() {
  const callbacks = new Set<(now: number) => void>();
  const clock: TimeoutController = {
    setTimeout(callback) {
      callbacks.add(callback);
      return () => { callbacks.delete(callback); };
    },
  };
  return {
    clock,
    get pending() { return callbacks.size; },
    frame(now: number) {
      const frame = [...callbacks];
      callbacks.clear();
      for (const callback of frame) callback(now);
    },
  };
}

function animation(onAnimationEnd = vi.fn(), animationBegin = 0) {
  return new JavascriptAnimation({
    animationId: "chart",
    onAnimationStart: undefined,
    onAnimationEnd,
    animationDuration: CHART_ANIMATION.animationDuration,
    animationBegin,
    from: 0,
    to: 100,
    easing: (value) => value,
  });
}

describe("chart animation playback", () => {
  it("freezes multiple charts and resumes from their last frame without counting paused time", () => {
    const playback = createChartAnimationController();
    const timer = frameClock();
    const listeners = [vi.fn(), vi.fn()];
    const ends = [vi.fn(), vi.fn()];
    for (let i = 0; i < listeners.length; i++) {
      playback.controller(timer.clock, animation(ends[i]), listeners[i]!);
    }
    timer.frame(100);
    timer.frame(100);
    timer.frame(350);
    for (const listener of listeners) expect(listener).toHaveBeenLastCalledWith(50);

    playback.pause();
    expect(timer.pending).toBe(0);
    timer.frame(10_000);
    for (const listener of listeners) expect(listener).toHaveBeenCalledTimes(2);

    playback.resume();
    timer.frame(10_000);
    for (const listener of listeners) expect(listener).toHaveBeenLastCalledWith(50);
    timer.frame(10_125);
    for (const listener of listeners) expect(listener).toHaveBeenLastCalledWith(75);
    timer.frame(10_250);
    for (const listener of listeners) expect(listener).toHaveBeenLastCalledWith(100);
    for (const end of ends) expect(end).toHaveBeenCalledOnce();
    expect(timer.pending).toBe(0);

    playback.pause();
    playback.resume();
    expect(timer.pending).toBe(0);
  });

  it("queues charts mounted during a pause and removes charts unmounted before resuming", () => {
    const playback = createChartAnimationController();
    const timer = frameClock();
    const listener = vi.fn();
    const removed = vi.fn();
    playback.pause();
    playback.controller(timer.clock, animation(), listener);
    const cancel = playback.controller(timer.clock, animation(), removed);
    expect(timer.pending).toBe(0);
    cancel();

    playback.resume();
    expect(timer.pending).toBe(1);
    timer.frame(10_000);
    timer.frame(10_000);
    expect(listener).toHaveBeenLastCalledWith(0);
    timer.frame(10_500);
    expect(listener).toHaveBeenLastCalledWith(100);
    expect(removed).not.toHaveBeenCalled();
    expect(timer.pending).toBe(0);
  });

  it("keeps repeated pause and resume calls idempotent, including before the first frame", () => {
    const playback = createChartAnimationController();
    const timer = frameClock();
    const end = vi.fn();
    playback.resume();
    const cancel = playback.controller(timer.clock, animation(end), vi.fn());
    playback.resume();
    expect(timer.pending).toBe(1);
    playback.pause();
    playback.pause();
    expect(timer.pending).toBe(0);
    playback.resume();
    playback.resume();
    expect(timer.pending).toBe(1);
    timer.frame(0);
    timer.frame(0);
    timer.frame(500);
    expect(end).toHaveBeenCalledOnce();
    cancel();
    cancel();
    playback.pause();
    playback.resume();
    expect(timer.pending).toBe(0);
  });

  it("cancels in-flight callbacks when a chart unmounts", () => {
    const playback = createChartAnimationController();
    const timer = frameClock();
    const listener = vi.fn();
    const end = vi.fn();
    const cancel = playback.controller(timer.clock, animation(end), listener);
    timer.frame(0);
    timer.frame(0);
    timer.frame(100);
    expect(listener).toHaveBeenLastCalledWith(20);
    cancel();
    expect(timer.pending).toBe(0);
    playback.pause();
    playback.resume();
    timer.frame(1000);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(end).not.toHaveBeenCalled();
  });

  it("preserves any remaining start delay across a pause", () => {
    const playback = createChartAnimationController();
    const timer = frameClock();
    const listener = vi.fn();
    playback.controller(timer.clock, animation(vi.fn(), 100), listener);
    timer.frame(0);
    timer.frame(50);
    playback.pause();
    playback.resume();
    timer.frame(1000);
    timer.frame(1049);
    expect(listener).not.toHaveBeenCalled();
    timer.frame(1050);
    expect(listener).toHaveBeenLastCalledWith(0);
    timer.frame(1550);
    expect(listener).toHaveBeenLastCalledWith(100);
    expect(timer.pending).toBe(0);
  });
});
