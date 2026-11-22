import type { Analysis, RenderResult } from './core/pipeline';
import type { PaletteEntry, RGBAImage, Settings } from './core/types';

export type WorkerRequest =
  /**
   * `image` is sent (and its buffer transferred) only for a new image; the worker
   * caches it and re-analyses from that cache when only settings change.
   */
  | { type: 'analyze'; requestId: number; image?: RGBAImage; settings: Settings }
  | { type: 'render'; requestId: number; palette: PaletteEntry[]; settings: Settings };

export type WorkerResponse =
  | { type: 'analyzed'; requestId: number; analysis: Analysis }
  | { type: 'rendered'; requestId: number; result: RenderResult }
  | { type: 'error'; op: 'analyze' | 'render'; requestId: number; message: string }
  /** Dev builds only: stage timings of one analyze/render run (see core/timing.ts). */
  | { type: 'timing'; label: string; stages: [string, number][]; totalMs: number };

/**
 * Merge rule for the worker queue: an analyze that replaces a waiting analyze inherits
 * that request's new image (its buffer was already transferred and exists nowhere else).
 */
export function carryNewImage(older: WorkerRequest, newer: WorkerRequest): WorkerRequest {
  if (newer.type === 'analyze' && newer.image === undefined && older.type === 'analyze' && older.image) {
    return { ...newer, image: older.image };
  }
  return newer;
}
