export class Queue {
  private activeCount = 0;
  private maximum: number;
  private readonly newWaiters = new Set<Waiter>();

  public constructor(maximum = 10) {
    this.maximum = maximum;
  }

  public async takeLease() {
    await this.waitFor((q) => q.activeCount < q.maximum);

    this.activeCount++;
    this.informWaiters();

    const lease: ILease = {
      release: this.releaseLease,
    };
    return lease;
  }

  public async waitForEmpty() {
    await this.waitFor((q) => q.activeCount === 0);
  }

  private readonly releaseLease = () => {
    this.activeCount--;
    this.informWaiters();
  };

  private informWaiters() {
    console.log(`informWaiters; has ${this.newWaiters.size}`);
    const toRemove = new Set<Waiter>();

    for (const waiter of this.newWaiters) {
      if (waiter.condition(this)) {
        toRemove.add(waiter);
        waiter.resolver();
      }
    }

    for (const expiredWaiter of toRemove) {
      this.newWaiters.delete(expiredWaiter);
    }
  }

  private async waitFor(condition: (q: Queue) => boolean): Promise<void> {
    if (condition(this)) {
      return;
    }

    return new Promise((resolve) => {
      this.newWaiters.add(new Waiter(condition, resolve));
    });
  }
}

class Waiter {
  public constructor(
    public readonly condition: (q: Queue) => boolean,
    public readonly resolver: () => void
  ) {}
}

export interface ILease {
  release(): void;
}
