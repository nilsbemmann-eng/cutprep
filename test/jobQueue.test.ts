import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type RGBAImage } from '../src/core/types';
import { LatestWinsQueue } from '../src/jobQueue';
import { carryNewImage, type WorkerRequest } from '../src/workerProtocol';

type Job = { type: 'analyze' | 'render'; id: number };
const an = (id: number): Job => ({ type: 'analyze', id });
const re = (id: number): Job => ({ type: 'render', id });

describe('LatestWinsQueue', () => {
  it('hands out one job at a time until finish', () => {
    const q = new LatestWinsQueue<Job>();
    expect(q.enqueue(re(1))).toEqual([]);
    expect(q.take()).toEqual(re(1));
    q.enqueue(re(2));
    expect(q.take()).toBeNull();
    q.finish();
    expect(q.take()).toEqual(re(2));
    q.finish();
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
});

describe('LatestWinsQueue with carryNewImage', () => {
  const img = (n: number): RGBAImage => ({ width: n, height: 1, data: new Uint8ClampedArray(4 * n) });
  const analyzeReq = (requestId: number, image?: RGBAImage): WorkerRequest => ({
    type: 'analyze',
    requestId,
    settings: DEFAULT_SETTINGS,
    image,
  });
  const renderReq = (requestId: number): WorkerRequest => ({
    type: 'render',
    requestId,
    palette: [],
    settings: DEFAULT_SETTINGS,
  });

  it('a settings-only analyze replacing a pending analyze with a new image analyses that image', () => {
    const q = new LatestWinsQueue<WorkerRequest>(carryNewImage);
    const second = img(2);
    q.enqueue(analyzeReq(1, img(1)));
    q.take();
    q.enqueue(analyzeReq(2, second));
    q.enqueue(analyzeReq(3));
    q.finish();
    const next = q.take();
    expect(next).toMatchObject({ type: 'analyze', requestId: 3 });
    expect(next?.type === 'analyze' && next.image).toBe(second);
  });

  it('a newer image wins over an older pending one', () => {
    const q = new LatestWinsQueue<WorkerRequest>(carryNewImage);
    const third = img(3);
    q.enqueue(renderReq(1));
    q.take();
    q.enqueue(analyzeReq(2, img(2)));
    q.enqueue(analyzeReq(3, third));
    q.finish();
    const next = q.take();
    expect(next?.type === 'analyze' && next.image).toBe(third);
  });
});
