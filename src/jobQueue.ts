/**
 * Latest-wins scheduling for the worker: one job runs at a time; while it runs, at most
 * one analyze and one render wait. A newer job of the same kind replaces the waiting one,
 * and a new analyze also drops a waiting render (the UI renders again after 'analyzed').
 * Superseded jobs never run. Pure (no worker/DOM APIs) so it can be unit-tested.
 */
export interface QueueJob {
  type: 'analyze' | 'render';
}

export class LatestWinsQueue<J extends QueueJob> {
  private running: J | null = null;
  private pendingAnalyze: J | null = null;
  private pendingRender: J | null = null;

  get busy(): boolean {
    return this.running !== null;
  }

  /** Queues a job and returns the waiting jobs it superseded (they get no work). */
  enqueue(job: J): J[] {
    const dropped: J[] = [];
    if (job.type === 'analyze') {
      if (this.pendingAnalyze) dropped.push(this.pendingAnalyze);
      if (this.pendingRender) dropped.push(this.pendingRender);
      this.pendingAnalyze = job;
      this.pendingRender = null;
    } else {
      if (this.pendingRender) dropped.push(this.pendingRender);
      this.pendingRender = job;
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

  /** True when `job` will not (or should no longer) produce a result anyone waits for. */
  isStale(job: J): boolean {
    if (job === this.running) return this.shouldAbortRunning();
    return job !== this.pendingAnalyze && job !== this.pendingRender;
  }
}
