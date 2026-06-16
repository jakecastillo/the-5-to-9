/** Concurrency-1 FIFO mutex: the single-writer guarantee (spec §3.2). */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job, job);
    // Keep the chain alive even if a job rejects, without leaking unhandled rejections.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
