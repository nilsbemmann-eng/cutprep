import type { Analysis, RenderResult } from './core/pipeline';
import type { PaletteEntry, RGBAImage, Settings } from './core/types';

export type WorkerRequest =
  | { type: 'analyze'; requestId: number; image: RGBAImage; settings: Settings }
  | { type: 'render'; requestId: number; palette: PaletteEntry[]; settings: Settings };

export type WorkerResponse =
  | { type: 'analyzed'; requestId: number; analysis: Analysis }
  | { type: 'rendered'; requestId: number; result: RenderResult }
  | { type: 'error'; requestId: number; message: string };
