import { Queue } from './lease-queue.js';

/**
 * Runs a series of asynchronous tasks, running them in
 * parallel up to a specified maximum limit.
 */
export class TaskQueue {
  private readonly leaseQueue: Queue;
  private waiting = 0;

  public constructor(maximum: number, public readonly name = '') {
    this.leaseQueue = new Queue(maximum, name);
  }

  /**
   * Queues a piece of work to be done.
   * @param worker
   * @returns A promise which resolves when the work starts;
   * by running in a synchronous loop, calling this method and waiting, it's
   * easy to run a maximum set of tasks in parallel.
   */
  public async queue(worker: () => Promise<void>, count = 1) {
    this.waiting++;
    const lease = await this.leaseQueue.takeLease(count);
    this.waiting--;

    void worker().finally(() => lease.release());
  }

  public async waitForEmpty() {
    do {
      console.log(this.name, 'task-queue waitFor empty. waiting:', this.waiting);
      await this.leaseQueue.waitForEmpty();
      console.log(this.name, 'task-queue empty. waiting:', this.waiting);
    } while (this.waiting);
  }
}
