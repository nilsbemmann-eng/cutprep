import { afterEach, describe, expect, it } from 'vitest';
import { setTimingSink, startTimer } from '../src/core/timing';

describe('timing', () => {
  afterEach(() => setTimingSink(null));

  it('measures nothing without a sink', () => {
    expect(startTimer('x')).toBeNull();
  });

  it('reports laps in order to the sink', () => {
    const got: { label: string; stages: string[]; total: number }[] = [];
    setTimingSink((label, stages, total) => got.push({ label, stages: stages.map((s) => s[0]), total }));
    const t = startTimer('render')!;
    t.lap('masks');
    t.lap('trace a');
    t.done('abgebrochen');
    expect(got).toHaveLength(1);
    expect(got[0].label).toBe('render abgebrochen');
    expect(got[0].stages).toEqual(['masks', 'trace a']);
    expect(got[0].total).toBeGreaterThanOrEqual(0);
  });
});
