import { analyze, render, RenderAbortedError, type Analysis } from './core/pipeline';
import { setTimingSink } from './core/timing';
import { createPotraceTracer, type Tracer } from './core/trace';
import type { RGBAImage } from './core/types';
import { LatestWinsQueue } from './jobQueue';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

/** Source image of the current file (already capped at 2400 px by the UI). */
let source: RGBAImage | null = null;
/** Analysis of `source`; null while none succeeded for the current request. */
let cached: Analysis | null = null;
let tracerPromise: Promise<Tracer> | null = null;

/**
 * Only the newest request of each kind is worked on; superseded ones get no response.
 * That is safe for the UI: it only waits for its newest requestId, and a request is
 * dropped only once a newer one (which will answer) has arrived.
 */
const queue = new LatestWinsQueue<WorkerRequest>();
let pumping = false;

/** A macrotask: lets message events that arrived meanwhile reach onmessage (microtasks don't). */
const yieldToEvents = () => new Promise<void>((r) => setTimeout(r, 0));

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

// Dev only: forward stage timings to the page (worker consoles are easy to miss).
if (import.meta.env.DEV) {
  setTimingSink((label, stages, totalMs) => post({ type: 'timing', label, stages, totalMs }));
}

async function run(req: WorkerRequest): Promise<void> {
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
  } else {
    const a = cached;
    if (!a) throw new Error('Kein Bild geladen');
    tracerPromise ??= createPotraceTracer();
    const tracer = await tracerPromise;
    // Yield after every layer so newer requests can arrive and abort this render.
    const yielding: Tracer = async (...args) => {
      const paths = await tracer(...args);
      await yieldToEvents();
      return paths;
    };
    const result = await render(a, req.palette, req.settings, yielding, () => queue.shouldAbortRunning());
    post({ type: 'rendered', requestId: req.requestId, result });
  }
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      // Collect requests posted while the previous job ran before picking the next one.
      await yieldToEvents();
      const req = queue.take();
      if (!req) break;
      try {
        await run(req);
      } catch (e) {
        // A superseded render was aborted on purpose: its successor answers instead.
        if (!(e instanceof RenderAbortedError)) {
          post({
            type: 'error',
            op: req.type,
            requestId: req.requestId,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      } finally {
        queue.finish();
      }
    }
  } finally {
    pumping = false;
  }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const dropped = queue.enqueue(ev.data);
  if (import.meta.env.DEV) {
    for (const d of dropped) post({ type: 'timing', label: `${d.type} #${d.requestId} verworfen`, stages: [], totalMs: 0 });
  }
  void pump();
};
