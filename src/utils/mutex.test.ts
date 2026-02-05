import { describe, it, expect } from 'vitest';
import { Mutex } from './mutex.js';

describe('Mutex', () => {
  it('should allow single acquisition', async () => {
    const mutex = new Mutex();
    const release = await mutex.acquire();
    expect(release).toBeInstanceOf(Function);
    release();
  });

  it('should queue multiple acquisitions', async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    const release1 = await mutex.acquire();
    
    const promise2 = mutex.acquire().then((release) => {
      order.push(2);
      return release;
    });
    
    const promise3 = mutex.acquire().then((release) => {
      order.push(3);
      return release;
    });

    order.push(1);
    release1();
    
    const release2 = await promise2;
    release2();
    
    const release3 = await promise3;
    release3();

    expect(order).toEqual([1, 2, 3]);
  });

  it('should run exclusive operations in sequence', async () => {
    const mutex = new Mutex();
    const results: number[] = [];
    let counter = 0;

    const operation = async (id: number) => {
      const localCounter = ++counter;
      await new Promise(resolve => setTimeout(resolve, 10));
      results.push(localCounter);
      return localCounter;
    };

    const promises = [
      mutex.runExclusive(() => operation(1)),
      mutex.runExclusive(() => operation(2)),
      mutex.runExclusive(() => operation(3))
    ];

    await Promise.all(promises);

    expect(results).toEqual([1, 2, 3]);
  });

  it('should release mutex even if operation throws', async () => {
    const mutex = new Mutex();
    
    try {
      await mutex.runExclusive(async () => {
        throw new Error('Test error');
      });
    } catch (e) {
      expect((e as Error).message).toBe('Test error');
    }

    const released = await Promise.race([
      mutex.acquire(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
    ]);

    expect(released).toBeInstanceOf(Function);
  });

  it('should return value from runExclusive', async () => {
    const mutex = new Mutex();
    const result = await mutex.runExclusive(async () => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('should handle concurrent runExclusive calls', async () => {
    const mutex = new Mutex();
    const execution: string[] = [];

    const task1 = mutex.runExclusive(async () => {
      execution.push('start-1');
      await new Promise(resolve => setTimeout(resolve, 20));
      execution.push('end-1');
    });

    const task2 = mutex.runExclusive(async () => {
      execution.push('start-2');
      await new Promise(resolve => setTimeout(resolve, 10));
      execution.push('end-2');
    });

    await Promise.all([task1, task2]);

    expect(execution).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });
});
