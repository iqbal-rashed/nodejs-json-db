import type { Document, CollectionData, HighConcurrencyOptions, JsonDBOptions } from '../types';
import { WriteQueue, WriteOperation, BatchProcessor } from './WriteQueue';
import { PartitionManager } from './PartitionManager';
import { WorkerPool, parallelLimit } from './WorkerPool';

/**
 * Default high-concurrency options
 */
const DEFAULT_HC_OPTIONS: Required<Omit<HighConcurrencyOptions, 'enabled'>> = {
  partitions: 16,
  batchSize: 1000,
  flushInterval: 100,
  maxConcurrentIO: 4,
  coalesceWrites: true,
};

/**
 * HighConcurrencyStorage - Storage adapter optimized for high-throughput scenarios
 * 
 * Features:
 * - Write buffering with automatic batch flushing
 * - Data sharding across multiple partitions
 * - Parallel I/O with concurrency limits
 * - Operation coalescing for duplicate writes
 */
export class HighConcurrencyStorage {
  private readonly partitionManager: PartitionManager;
  private readonly writeQueue: WriteQueue;
  private readonly workerPool: WorkerPool;
  private readonly options: Required<Omit<HighConcurrencyOptions, 'enabled'>>;

  constructor(dbOptions: JsonDBOptions) {
    const hcOptions = dbOptions.highConcurrency;
    this.options = {
      ...DEFAULT_HC_OPTIONS,
      ...hcOptions,
    };

    this.partitionManager = new PartitionManager(dbOptions.dataDir, {
      partitionCount: this.options.partitions,
      prettyPrint: dbOptions.prettyPrint ?? true,
      fileExtension: dbOptions.fileExtension ?? '.json',
    });

    this.workerPool = new WorkerPool({
      maxConcurrent: this.options.maxConcurrentIO,
    });

    const batchProcessor: BatchProcessor = this.processBatch.bind(this);
    this.writeQueue = new WriteQueue(batchProcessor, {
      batchSize: this.options.batchSize,
      flushInterval: this.options.flushInterval,
      coalesceWrites: this.options.coalesceWrites,
    });
  }

  /**
   * Process a batch of write operations
   */
  private async processBatch(
    operations: Map<string, WriteOperation[]>
  ): Promise<void> {
    const collectionOps = Array.from(operations.entries());

    // Process each collection in parallel
    await parallelLimit(
      collectionOps,
      this.options.maxConcurrentIO,
      async ([collectionName, ops]) => {
        await this.processCollectionOperations(collectionName, ops);
      }
    );
  }

  /**
   * Process operations for a single collection
   */
  private async processCollectionOperations(
    collectionName: string,
    operations: WriteOperation[]
  ): Promise<void> {
    // Group operations by partition
    const partitionOps = new Map<number, WriteOperation[]>();

    const getPartitionOps = (index: number): WriteOperation[] => {
      let ops = partitionOps.get(index);
      if (!ops) {
        ops = [];
        partitionOps.set(index, ops);
      }
      return ops;
    };

    for (const op of operations) {
      if (op.type === 'fullWrite' || op.type === 'clear') {
        // These affect all partitions
        for (let i = 0; i < this.partitionManager.getPartitionCount(); i++) {
          getPartitionOps(i).push(op);
        }
      } else if (op.type === 'insert') {
        const partitionIndex = this.partitionManager.getPartitionIndex(op.document._id);
        getPartitionOps(partitionIndex).push(op);
      } else if (op.type === 'update' || op.type === 'delete') {
        const partitionIndex = this.partitionManager.getPartitionIndex(op.documentId);
        getPartitionOps(partitionIndex).push(op);
      } else if (op.type === 'bulkInsert') {
        for (const doc of op.documents) {
          const partitionIndex = this.partitionManager.getPartitionIndex(doc._id);
          getPartitionOps(partitionIndex).push({
            type: 'insert',
            collectionName,
            document: doc,
          });
        }
      } else if (op.type === 'bulkUpdate' || op.type === 'bulkDelete') {
        for (const docId of op.documentIds) {
          const partitionIndex = this.partitionManager.getPartitionIndex(docId);

          if (op.type === 'bulkUpdate') {
            getPartitionOps(partitionIndex).push({
              type: 'update',
              collectionName,
              documentId: docId,
              changes: op.changes,
            });
          } else {
            getPartitionOps(partitionIndex).push({
              type: 'delete',
              collectionName,
              documentId: docId,
            });
          }
        }
      }
    }

    // Process each partition in parallel
    await parallelLimit(
      Array.from(partitionOps.entries()),
      this.options.maxConcurrentIO,
      async ([partitionIndex, ops]) => {
        await this.processPartitionOperations(collectionName, partitionIndex, ops);
      }
    );
  }

  /**
   * Process operations for a single partition
   */
  private async processPartitionOperations(
    collectionName: string,
    partitionIndex: number,
    operations: WriteOperation[]
  ): Promise<void> {
    // Read current partition data
    let data = await this.partitionManager.readPartition<Document>(
      collectionName,
      partitionIndex
    );

    if (!data) {
      data = {
        name: collectionName,
        documents: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // Apply operations
    for (const op of operations) {
      switch (op.type) {
        case 'insert':
          data.documents.push(op.document);
          break;

        case 'update': {
          const updateIndex = data.documents.findIndex((d) => d._id === op.documentId);
          if (updateIndex !== -1) {
            Object.assign(data.documents[updateIndex], op.changes);
          }
          break;
        }

        case 'delete': {
          const deleteIndex = data.documents.findIndex((d) => d._id === op.documentId);
          if (deleteIndex !== -1) {
            data.documents.splice(deleteIndex, 1);
          }
          break;
        }

        case 'clear':
          data.documents = [];
          break;

        case 'fullWrite': {
          // For fullWrite, completely replace partition data
          // Only include documents that belong to this partition
          const partitionDocs = (op.data as CollectionData<Document>).documents.filter(
            (doc) => this.partitionManager.getPartitionIndex(doc._id) === partitionIndex
          );
          data.documents = partitionDocs;
          break;
        }
      }
    }

    // Write partition back
    await this.partitionManager.writePartition(collectionName, partitionIndex, data);
  }

  /**
   * Enqueue an insert operation
   */
  async insert<T extends Document>(collectionName: string, document: T): Promise<void> {
    await this.writeQueue.enqueue({
      type: 'insert',
      collectionName,
      document,
    });
  }

  /**
   * Enqueue a bulk insert operation
   */
  async insertMany<T extends Document>(collectionName: string, documents: T[]): Promise<void> {
    await this.writeQueue.enqueue({
      type: 'bulkInsert',
      collectionName,
      documents,
    });
  }

  /**
   * Enqueue an update operation
   */
  async update<T extends Document>(
    collectionName: string,
    documentId: string,
    changes: Partial<T>
  ): Promise<void> {
    await this.writeQueue.enqueue({
      type: 'update',
      collectionName,
      documentId,
      changes,
    });
  }

  /**
   * Enqueue a delete operation
   */
  async delete(collectionName: string, documentId: string): Promise<void> {
    await this.writeQueue.enqueue({
      type: 'delete',
      collectionName,
      documentId,
    });
  }

  /**
   * Enqueue a clear operation
   */
  async clear(collectionName: string): Promise<void> {
    await this.writeQueue.enqueue({
      type: 'clear',
      collectionName,
    });
  }

  /**
   * Read a document by ID (bypasses queue, reads directly)
   */
  async findById<T extends Document>(
    collectionName: string,
    documentId: string
  ): Promise<T | null> {
    // Flush pending writes first to ensure consistency
    await this.writeQueue.flush();
    return this.partitionManager.findById<T>(collectionName, documentId);
  }

  /**
   * Read all documents from a collection
   */
  async readAll<T extends Document>(collectionName: string): Promise<T[]> {
    await this.writeQueue.flush();
    return this.partitionManager.getAllDocuments<T>(collectionName);
  }

  /**
   * Check if a collection exists
   */
  async exists(collectionName: string): Promise<boolean> {
    const collections = await this.partitionManager.listCollections();
    return collections.includes(collectionName);
  }

  /**
   * Initialize a collection with empty partitions
   */
  async initializeCollection(collectionName: string): Promise<void> {
    await this.partitionManager.initializePartitions(collectionName);
  }

  /**
   * Delete a collection and all its partitions
   */
  async deleteCollection(collectionName: string): Promise<void> {
    await this.writeQueue.flush();
    await this.partitionManager.deleteCollection(collectionName);
  }

  /**
   * List all collections
   */
  async listCollections(): Promise<string[]> {
    return this.partitionManager.listCollections();
  }

  /**
   * Flush all pending writes
   */
  async flush(): Promise<void> {
    await this.writeQueue.flush();
  }

  /**
   * Gracefully shutdown the storage
   */
  async shutdown(): Promise<void> {
    await this.writeQueue.shutdown();
    await this.workerPool.shutdown();
  }

  /**
   * Get pending write count
   */
  pendingWrites(): number {
    return this.writeQueue.pending();
  }

  /**
   * Get worker pool statistics
   */
  getStats() {
    return {
      pendingWrites: this.writeQueue.pending(),
      workerPool: this.workerPool.getStats(),
      partitions: this.options.partitions,
    };
  }

  /**
   * Clear cache for a collection
   */
  clearCache(collectionName?: string): void {
    this.partitionManager.clearCache(collectionName);
  }
}
