/**
 * Dev-only stage timings. Production builds replace `import.meta.env.DEV` with false,
 * so startTimer() returns null and every `timer?.lap(...)` call folds away.
 * Nothing is measured until a sink is installed (the worker does that in dev).
 */
export type TimingSink = (label: string, stages: [string, number][], totalMs: number) => void;

let sink: TimingSink | null = null;

export function setTimingSink(s: TimingSink | null): void {
  if (import.meta.env.DEV) sink = s;
}

export interface StageTimer {
  /** Records the time since the previous lap (or the start) under `stage`. */
  lap(stage: string): void;
  /** Reports all laps to the sink; `suffix` is appended to the label (e.g. "abgebrochen"). */
  done(suffix?: string): void;
}

export function startTimer(label: string): StageTimer | null {
  if (!import.meta.env.DEV || !sink) return null;
  const report = sink;
  const start = performance.now();
  let last = start;
  const stages: [string, number][] = [];
  return {
    lap(stage) {
      const now = performance.now();
      stages.push([stage, now - last]);
      last = now;
    },
    done(suffix) {
      report(suffix ? `${label} ${suffix}` : label, stages, performance.now() - start);
    },
  };
}
