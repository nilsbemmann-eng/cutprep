import { describe, expect, it } from 'vitest';
import { LatestWinsQueue } from '../src/jobQueue';

type Job = { type: 'analyze' | 'render'; id: number };
const an = (id: number): Job => ({ type: 'analyze', id });
const re = (id: number): Job => ({ type: 'render', id });

describe('LatestWinsQueue', () => {
  it('hands out a job when idle and is busy until finish', () => {
    const q = new LatestWinsQueue<Job>();
    expect(q.busy).toBe(false);
    expect(q.enqueue(re(1))).toEqual([]);
    expect(q.take()).toEqual(re(1));
    expect(q.busy).toBe(true);
    expect(q.take()).toBeNull();
    q.finish();
    expect(q.busy).toBe(false);
    expect(q.take()).toBeNull();
  });

  it('a newer render replaces the pending render', () => {
    const q = new LatestWinsQueue<Job>();
    q.enqueue(re(1));
    q.take();
    q.enqueue(re(2));
    expect(q.enqueue(re(3))).toEqual([re(2)]);
    expect(q.enqueue(re(4))).toEqual([re(3)]);
    q.finish();
    expect(q.take()).toEqual(re(4));
    q.finish();
    expect(q.take()).toBeNull();
  });

  it('a newer analyze replaces the pending analyze and makes a pending render obsolete', () => {
    const q = new LatestWinsQueue<Job>();
    q.enqueue(an(1));
    q.take();
    q.enqueue(an(2));
    q.enqueue(re(5));
    expect(q.enqueue(an(3))).toEqual([an(2), re(5)]);
    q.finish();
    expect(q.take()).toEqual(an(3));
    q.finish();
    expect(q.take()).toBeNull();
  });

  it('a render arriving after a pending analyze runs after it', () => {
    const q = new LatestWinsQueue<Job>();
    q.enqueue(re(1));
    q.take();
    q.enqueue(an(2));
    q.enqueue(re(3));
    q.finish();
    expect(q.take()).toEqual(an(2));
    q.finish();
    expect(q.take()).toEqual(re(3));
  });

  it('asks a running render to abort once a newer render or analyze is pending', () => {
    const q = new LatestWinsQueue<Job>();
    q.enqueue(re(1));
    q.take();
    expect(q.shouldAbortRunning()).toBe(false);
    q.enqueue(re(2));
    expect(q.shouldAbortRunning()).toBe(true);

    const q2 = new LatestWinsQueue<Job>();
    q2.enqueue(re(1));
    q2.take();
    q2.enqueue(an(2));
    expect(q2.shouldAbortRunning()).toBe(true);
  });

  it('never aborts a running analyze', () => {
    const q = new LatestWinsQueue<Job>();
    q.enqueue(an(1));
    q.take();
    q.enqueue(an(2));
    q.enqueue(re(3));
    expect(q.shouldAbortRunning()).toBe(false);
  });

  it('isStale tells whether a job was superseded or is still current', () => {
    const q = new LatestWinsQueue<Job>();
    const first = re(1);
    q.enqueue(first);
    q.take();
    expect(q.isStale(first)).toBe(false);
    q.enqueue(re(2));
    expect(q.isStale(first)).toBe(true);
  });
});
