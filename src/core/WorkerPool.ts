/**
 * Task function type for worker pool
 */
export type TaskFunction<T = void> = () => Promise<T>;

/**
 * Queued task with promise resolution
 */
interface QueuedTask<T = unknown> {
  task: TaskFunction<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  priority: number;
}

/**
 * Worker pool options
 */
export interface WorkerPoolOptions {
  /** Maximum concurrent operations (default: 4) */
  maxConcurrent?: number;
  /** Maximum queue size before rejecting new tasks (default: 10000) */
  maxQueueSize?: number;
}

/**
 * Worker pool statistics
 */
export interface WorkerPoolStats {
  activeWorkers: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
}

/**
 * WorkerPool - Manages parallel I/O operations with concurrency limits
 * 
 * Features:
 * - Configurable concurrency limit
 * - Priority queue for task ordering
 * - Backpressure handling (rejects when queue full)
 * - Statistics tracking
 */
export class WorkerPool {
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;
  private readonly queue: QueuedTask[] = [];
  private activeCount: number = 0;
  private completedCount: number = 0;
  private failedCount: number = 0;
  private isShuttingDown: boolean = false;

  constructor(options: WorkerPoolOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 4;
    this.maxQueueSize = options.maxQueueSize ?? 10000;
  }

  /**
   * Submit a task to the worker pool
   * @param task The async function to execute
   * @param priority Higher priority tasks are executed first (default: 0)
   */
  async submit<T>(task: TaskFunction<T>, priority: number = 0): Promise<T> {
    if (this.isShuttingDown) {
      throw new Error('WorkerPool is shutting down, no new tasks accepted');
    }

    if (this.queue.length >= this.maxQueueSize) {
      throw new Error('WorkerPool queue is full, task rejected (backpressure)');
    }

    return new Promise<T>((resolve, reject) => {
      const queuedTask: QueuedTask<T> = {
        task,
        resolve,
        reject,
        priority,
      };

      // Insert in priority order (higher priority first)
      let inserted = false;
      for (let i = 0; i < this.queue.length; i++) {
        if (priority > this.queue[i].priority) {
          this.queue.splice(i, 0, queuedTask as QueuedTask);
          inserted = true;
          break;
        }
      }

      if (!inserted) {
        this.queue.push(queuedTask as QueuedTask);
      }

      // Try to process immediately
      this.processNext();
    });
  }

  /**
   * Submit multiple tasks and wait for all to complete
   */
  async submitAll<T>(tasks: TaskFunction<T>[], priority: number = 0): Promise<T[]> {
    const promises = tasks.map((task) => this.submit(task, priority));
    return Promise.all(promises);
  }

  /**
   * Submit multiple tasks and process results as they complete
   */
  async* submitStream<T>(
    tasks: TaskFunction<T>[],
    priority: number = 0
  ): AsyncGenerator<T, void, unknown> {
    const promises = tasks.map((task) => this.submit(task, priority));

    for (const promise of promises) {
      yield await promise;
    }
  }

  /**
   * Process the next task in the queue
   */
  private processNext(): void {
    if (this.activeCount >= this.maxConcurrent) return;
    if (this.queue.length === 0) return;

    const queuedTask = this.queue.shift();
    if (!queuedTask) return;

    this.activeCount++;

    queuedTask
      .task()
      .then((result) => {
        this.completedCount++;
        queuedTask.resolve(result);
      })
      .catch((error) => {
        this.failedCount++;
        queuedTask.reject(error);
      })
      .finally(() => {
        this.activeCount--;
        this.processNext();
      });
  }

  /**
   * Wait for all currently queued tasks to complete
   */
  async drain(): Promise<void> {
    return new Promise<void>((resolve) => {
      const checkComplete = () => {
        if (this.activeCount === 0 && this.queue.length === 0) {
          resolve();
        } else {
          setImmediate(checkComplete);
        }
      };
      checkComplete();
    });
  }

  /**
   * Gracefully shutdown the worker pool
   * Stops accepting new tasks and waits for existing ones to complete
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    await this.drain();
  }

  /**
   * Get current pool statistics
   */
  getStats(): WorkerPoolStats {
    return {
      activeWorkers: this.activeCount,
      queuedTasks: this.queue.length,
      completedTasks: this.completedCount,
      failedTasks: this.failedCount,
    };
  }

  /**
   * Check if pool is idle (no active or queued tasks)
   */
  isIdle(): boolean {
    return this.activeCount === 0 && this.queue.length === 0;
  }

  /**
   * Check if pool is shutting down
   */
  isClosing(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Get the current queue size
   */
  queueSize(): number {
    return this.queue.length;
  }

  /**
   * Get the number of active workers
   */
  activeWorkers(): number {
    return this.activeCount;
  }
}

/**
 * Helper to run tasks with limited concurrency
 * Simpler alternative to WorkerPool for one-off batch operations
 */
export async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    const currentIndex = index++;
    if (currentIndex >= items.length) return;

    results[currentIndex] = await fn(items[currentIndex], currentIndex);
    await runNext();
  }

  const workers = Array(Math.min(limit, items.length))
    .fill(null)
    .map(() => runNext());

  await Promise.all(workers);
  return results;
}
