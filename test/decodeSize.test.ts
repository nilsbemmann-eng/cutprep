import { describe, expect, it } from 'vitest';
import { decodeSize, MAX_DECODE_SIDE } from '../src/ui/input';

describe('decodeSize', () => {
  it('keeps images up to 2400 px unchanged (no upscaling)', () => {
    expect(decodeSize(995, 1283)).toEqual({ width: 995, height: 1283 });
    expect(decodeSize(2400, 10)).toEqual({ width: 2400, height: 10 });
  });
  it('caps the longest side at 2400 and keeps the aspect ratio', () => {
    expect(MAX_DECODE_SIDE).toBe(2400);
    expect(decodeSize(6000, 4000)).toEqual({ width: 2400, height: 1600 });
    expect(decodeSize(3000, 8000)).toEqual({ width: 900, height: 2400 });
  });
  it('never returns a zero side', () => {
    expect(decodeSize(100000, 10)).toEqual({ width: 2400, height: 1 });
  });
});
