/**
 * Latest-wins scheduling for the worker: one job runs at a time; while it runs, at most
 * one analyze and one render wait. A newer job of the same kind replaces the waiting one,
 * and a new analyze also drops a waiting render (the UI renders again after 'analyzed').
 * Superseded jobs never run. Pure (no worker/DOM APIs) so it can be unit-tested.
 *
 * `merge(older, newer)` builds the job that replaces a waiting job of the same kind, so
 * the newer job can inherit data it must not lose (the worker carries a new image over).
 */
export interface QueueJob {
  type: 'analyze' | 'render';
}

export class LatestWinsQueue<J extends QueueJob> {
  private running: J | null = null;
  private pendingAnalyze: J | null = null;
  private pendingRender: J | null = null;

  constructor(private readonly merge: (older: J, newer: J) => J = (_older, newer) => newer) {}

  /** Queues a job and returns the waiting jobs it superseded (they get no work). */
  enqueue(job: J): J[] {
    const dropped: J[] = [];
    if (job.type === 'analyze') {
      const older = this.pendingAnalyze;
      if (older) dropped.push(older);
      if (this.pendingRender) dropped.push(this.pendingRender);
      this.pendingAnalyze = older ? this.merge(older, job) : job;
      this.pendingRender = null;
    } else {
      const older = this.pendingRender;
      if (older) dropped.push(older);
      this.pendingRender = older ? this.merge(older, job) : job;
    }
    return dropped;
  }

  /**
   * Starts the next waiting job (analyze first: a waiting render always arrived after it)
   * and returns it; null while a job is running or nothing waits.
   */
  take(): J | null {
    if (this.running) return null;
    const job = this.pendingAnalyze ?? this.pendingRender;
    if (!job) return null;
    if (job === this.pendingAnalyze) this.pendingAnalyze = null;
    else this.pendingRender = null;
    this.running = job;
    return job;
  }

  /** Marks the running job as finished (completed, failed or aborted). */
  finish(): void {
    this.running = null;
  }

  /** True when the running job is a render that a newer waiting job makes pointless. */
  shouldAbortRunning(): boolean {
    return this.running?.type === 'render' && (this.pendingRender !== null || this.pendingAnalyze !== null);
  }
}
