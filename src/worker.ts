import { analyze, render, type Analysis } from './core/pipeline';
import { setTimingSink } from './core/timing';
import { createPotraceTracer, type Tracer } from './core/trace';
import type { RGBAImage } from './core/types';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

/** Source image of the current file (already capped at 2400 px by the UI). */
let source: RGBAImage | null = null;
/** Analysis of `source`; null while none succeeded for the current request. */
let cached: Analysis | null = null;
let tracerPromise: Promise<Tracer> | null = null;

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

// Dev only: forward stage timings to the page (worker consoles are easy to miss).
if (import.meta.env.DEV) {
  setTimingSink((label, stages, totalMs) => post({ type: 'timing', label, stages, totalMs }));
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'analyze') {
      // Never render a previous analysis after a new request (e.g. when this one fails).
      cached = null;
      if (req.image) source = req.image;
      if (!source) throw new Error('Kein Bild geladen');
      const a = analyze(source, req.settings);
      cached = a;
      // Send a copy of the labels so the cached buffer stays usable here.
      const labels = a.labels.slice();
      post({ type: 'analyzed', requestId: req.requestId, analysis: { ...a, labels } }, [labels.buffer]);
    } else if (req.type === 'render') {
      const a = cached;
      if (!a) throw new Error('Kein Bild geladen');
      tracerPromise ??= createPotraceTracer();
      const tracer = await tracerPromise;
      const result = await render(a, req.palette, req.settings, tracer);
      post({ type: 'rendered', requestId: req.requestId, result });
    }
  } catch (e) {
    post({
      type: 'error',
      op: req.type,
      requestId: req.requestId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
