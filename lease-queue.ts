export class Queue {
  private activeCount = 0;
  private readonly newWaiters = new Set<Waiter>();

  public constructor(private readonly maximum = 10, public readonly name = '') {}

  public async takeLease(count = 1) {
    await this.waitFor(
      (q) => q.activeCount === 0 || q.activeCount + count <= q.maximum,
      () => {
        this.activeCount += count;
      }
    );

    this.informWaiters();

    const lease: ILease = {
      release: () => this.releaseLease(count),
    };
    return lease;
  }

  public async waitForEmpty() {
    await this.waitFor((q) => {
      console.log(this.name, 'waitForEmpty...', q.activeCount);
      return q.activeCount === 0;
    });
  }

  private readonly releaseLease = (count: number) => {
    this.activeCount -= count;
    this.informWaiters();
  };

  private informWaiters() {
    const toRemove = new Set<Waiter>();

    for (const waiter of this.newWaiters) {
      if (waiter.condition(this)) {
        toRemove.add(waiter);
        waiter.onConditionFulfilled?.();
        waiter.resolver();
      }
    }

    for (const expiredWaiter of toRemove) {
      this.newWaiters.delete(expiredWaiter);
    }
  }

  private async waitFor(condition: (q: Queue) => boolean, onConditionFulfilled?: () => void): Promise<void> {
    if (condition(this)) {
      onConditionFulfilled?.();
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
    public readonly resolver: () => void,
    public readonly onConditionFulfilled?: () => void
  ) {}
}

export interface ILease {
  release(): void;
}
