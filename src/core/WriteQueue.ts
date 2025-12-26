import type { Document, CollectionData } from '../types';

/**
 * Write operation types
 */
export type WriteOperation<T extends Document = Document> =
  | { type: 'insert'; collectionName: string; document: T }
  | { type: 'update'; collectionName: string; documentId: string; changes: Partial<T> }
  | { type: 'delete'; collectionName: string; documentId: string }
  | { type: 'bulkInsert'; collectionName: string; documents: T[] }
  | { type: 'bulkUpdate'; collectionName: string; documentIds: string[]; changes: Partial<T> }
  | { type: 'bulkDelete'; collectionName: string; documentIds: string[] }
  | { type: 'clear'; collectionName: string }
  | { type: 'fullWrite'; collectionName: string; data: CollectionData<T> };

/**
 * Queued write with promise resolution
 */
interface QueuedWrite<T extends Document = Document> {
  operation: WriteOperation<T>;
  resolve: () => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * Write queue options
 */
export interface WriteQueueOptions {
  /** Maximum writes before automatic flush (default: 1000) */
  batchSize?: number;
  /** Maximum time in ms before automatic flush (default: 100) */
  flushInterval?: number;
  /** Whether to coalesce duplicate operations (default: true) */
  coalesceWrites?: boolean;
}

/**
 * Batch processor callback type
 */
export type BatchProcessor = (
  operations: Map<string, WriteOperation[]>
) => Promise<void>;

/**
 * WriteQueue - Buffers and batches write operations for high throughput
 * 
 * Features:
 * - Batches writes to reduce I/O operations
 * - Coalesces duplicate operations (e.g., multiple updates to same doc)
 * - Automatic flush by count or time interval
 * - Promise-based API for tracking write completion
 */
export class WriteQueue {
  private readonly batchSize: number;
  private readonly flushInterval: number;
  private readonly coalesceWrites: boolean;
  private readonly batchProcessor: BatchProcessor;

  private queue: Map<string, QueuedWrite[]> = new Map();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFlush: Promise<void> | null = null;
  private totalQueued: number = 0;
  private isShuttingDown: boolean = false;

  constructor(batchProcessor: BatchProcessor, options: WriteQueueOptions = {}) {
    this.batchSize = options.batchSize ?? 1000;
    this.flushInterval = options.flushInterval ?? 100;
    this.coalesceWrites = options.coalesceWrites ?? true;
    this.batchProcessor = batchProcessor;
  }

  /**
   * Enqueue a write operation
   * Returns a promise that resolves when the write is persisted
   */
  async enqueue<T extends Document>(operation: WriteOperation<T>): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('WriteQueue is shutting down, no new writes accepted');
    }

    return new Promise<void>((resolve, reject) => {
      const queuedWrite: QueuedWrite = {
        operation: operation as WriteOperation,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      const collectionName = operation.collectionName;

      let collectionQueue = this.queue.get(collectionName);
      if (!collectionQueue) {
        collectionQueue = [];
        this.queue.set(collectionName, collectionQueue);
      }

      // Coalesce if enabled
      if (this.coalesceWrites) {
        const coalesced = this.tryCoalesce(collectionName, queuedWrite);
        if (coalesced) {
          return; // Operation was merged into existing
        }
      }

      collectionQueue.push(queuedWrite);
      this.totalQueued++;

      // Start flush timer if not running
      this.scheduleFlush();

      // Flush immediately if batch size reached
      if (this.totalQueued >= this.batchSize) {
        this.flush().catch(reject);
      }
    });
  }

  /**
   * Try to coalesce a write with existing queued operations
   */
  private tryCoalesce(collectionName: string, queuedWrite: QueuedWrite): boolean {
    const collectionQueue = this.queue.get(collectionName);
    if (!collectionQueue || collectionQueue.length === 0) return false;

    const op = queuedWrite.operation;

    // Coalesce updates to the same document
    if (op.type === 'update') {
      for (let i = collectionQueue.length - 1; i >= 0; i--) {
        const existing = collectionQueue[i].operation;
        if (existing.type === 'update' && existing.documentId === op.documentId) {
          // Merge changes into existing update
          existing.changes = { ...existing.changes, ...op.changes };
          // Chain the promise
          const existingResolve = collectionQueue[i].resolve;
          collectionQueue[i].resolve = () => {
            existingResolve();
            queuedWrite.resolve();
          };
          return true;
        }
      }
    }

    // Coalesce delete after insert/update of same doc
    if (op.type === 'delete') {
      for (let i = collectionQueue.length - 1; i >= 0; i--) {
        const existing = collectionQueue[i].operation;
        if (
          (existing.type === 'insert' && existing.document._id === op.documentId) ||
          (existing.type === 'update' && existing.documentId === op.documentId)
        ) {
          // Remove the insert/update and keep the delete
          collectionQueue.splice(i, 1);
          this.totalQueued--;
        }
      }
    }

    // Clear supersedes all previous operations for collection
    if (op.type === 'clear' || op.type === 'fullWrite') {
      // Resolve all pending operations for this collection
      for (const queued of collectionQueue) {
        queued.resolve();
      }
      collectionQueue.length = 0;
      this.totalQueued -= collectionQueue.length;
    }

    return false;
  }

  /**
   * Schedule a flush if not already scheduled
   */
  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((err) => {
        console.error('WriteQueue flush error:', err);
      });
    }, this.flushInterval);
  }

  /**
   * Flush all pending writes
   */
  async flush(): Promise<void> {
    // If already flushing, wait for it
    if (this.pendingFlush) {
      return this.pendingFlush;
    }

    // Clear the timer if running
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Nothing to flush
    if (this.totalQueued === 0) return;

    // Capture current queue and reset
    const currentQueue = this.queue;
    this.queue = new Map();
    this.totalQueued = 0;

    // Prepare operations by collection
    const operations = new Map<string, WriteOperation[]>();
    for (const [collectionName, queuedWrites] of currentQueue) {
      operations.set(
        collectionName,
        queuedWrites.map((qw) => qw.operation)
      );
    }

    // Process the batch
    this.pendingFlush = this.processBatch(currentQueue, operations);
    await this.pendingFlush;
    this.pendingFlush = null;
  }

  /**
   * Process a batch of operations
   */
  private async processBatch(
    queuedWrites: Map<string, QueuedWrite[]>,
    operations: Map<string, WriteOperation[]>
  ): Promise<void> {
    try {
      await this.batchProcessor(operations);

      // Resolve all promises
      for (const writes of queuedWrites.values()) {
        for (const write of writes) {
          write.resolve();
        }
      }
    } catch (error) {
      // Reject all promises
      for (const writes of queuedWrites.values()) {
        for (const write of writes) {
          write.reject(error as Error);
        }
      }
    }
  }

  /**
   * Gracefully shutdown the queue
   * Flushes all pending writes and stops accepting new ones
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    await this.flush();
  }

  /**
   * Get the number of pending operations
   */
  pending(): number {
    return this.totalQueued;
  }

  /**
   * Check if the queue is empty
   */
  isEmpty(): boolean {
    return this.totalQueued === 0;
  }

  /**
   * Check if the queue is shutting down
   */
  isClosing(): boolean {
    return this.isShuttingDown;
  }
}
