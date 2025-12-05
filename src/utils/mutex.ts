export class Mutex {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          resolve(() => this.release());
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  private release(): void {
    this.locked = false;
    const next = this.queue.shift();
    if (next) next();
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const mutexes = new Map<string, Mutex>();

export function getFileMutex(path: string): Mutex {
  let mutex = mutexes.get(path);
  if (!mutex) {
    mutex = new Mutex();
    mutexes.set(path, mutex);
  }
  return mutex;
}
