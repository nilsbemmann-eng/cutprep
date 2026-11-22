import { analyze, render, type Analysis } from './core/pipeline';
import { createPotraceTracer, type Tracer } from './core/trace';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

let cached: Analysis | null = null;
let tracerPromise: Promise<Tracer> | null = null;

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'analyze') {
      cached = analyze(req.image, req.settings);
      // Send a copy of the labels so the cached buffer stays usable here.
      const labels = cached.labels.slice();
      post({ type: 'analyzed', requestId: req.requestId, analysis: { ...cached, labels } }, [labels.buffer]);
    } else if (req.type === 'render') {
      if (!cached) throw new Error('Kein Bild geladen');
      tracerPromise ??= createPotraceTracer();
      const tracer = await tracerPromise;
      const result = await render(cached, req.palette, req.settings, tracer);
      post({ type: 'rendered', requestId: req.requestId, result });
    }
  } catch (e) {
    post({
      type: 'error',
      requestId: req.requestId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
