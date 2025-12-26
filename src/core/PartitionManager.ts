import * as fs from 'fs';
import * as path from 'path';
import type { Document, CollectionData } from '../types';
import { StorageError } from '../errors';

/**
 * Partition options
 */
export interface PartitionOptions {
  /** Number of partitions (default: 16) */
  partitionCount?: number;
  /** Whether to pretty print JSON (default: true) */
  prettyPrint?: boolean;
  /** File extension (default: .json) */
  fileExtension?: string;
}

/**
 * Partition info for a collection
 */
interface PartitionInfo {
  name: string;
  partitionIndex: number;
  documentCount: number;
}

/**
 * PartitionManager - Distributes documents across multiple files (shards)
 * 
 * Features:
 * - Consistent hashing for document distribution
 * - Parallel I/O across partitions
 * - Automatic partition discovery and initialization
 * - Maintains per-partition caching
 */
export class PartitionManager {
  private readonly dataDir: string;
  private readonly partitionCount: number;
  private readonly prettyPrint: boolean;
  private readonly fileExtension: string;
  private readonly cache: Map<string, CollectionData<Document>> = new Map();
  private readonly locks: Map<string, Promise<void>> = new Map();

  constructor(dataDir: string, options: PartitionOptions = {}) {
    this.dataDir = path.resolve(dataDir);
    this.partitionCount = options.partitionCount ?? 16;
    this.prettyPrint = options.prettyPrint ?? true;
    this.fileExtension = options.fileExtension ?? '.json';

    this.ensureDirectory();
  }

  /**
   * Ensure the data directory exists
   */
  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
    } catch (error) {
      throw new StorageError(`Failed to create data directory: ${this.dataDir}`, error as Error);
    }
  }

  /**
   * Get partition index for a document ID using consistent hashing
   */
  getPartitionIndex(documentId: string): number {
    let hash = 0;
    for (let i = 0; i < documentId.length; i++) {
      const char = documentId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % this.partitionCount;
  }

  /**
   * Get partition file name
   */
  getPartitionFileName(collectionName: string, partitionIndex: number): string {
    return `${collectionName}_p${partitionIndex.toString().padStart(3, '0')}${this.fileExtension}`;
  }

  /**
   * Get partition file path
   */
  getPartitionFilePath(collectionName: string, partitionIndex: number): string {
    return path.join(this.dataDir, this.getPartitionFileName(collectionName, partitionIndex));
  }

  /**
   * Get cache key for a partition
   */
  private getCacheKey(collectionName: string, partitionIndex: number): string {
    return `${collectionName}:${partitionIndex}`;
  }

  /**
   * Acquire lock for a partition
   */
  private async acquireLock(cacheKey: string): Promise<() => void> {
    while (this.locks.has(cacheKey)) {
      await this.locks.get(cacheKey);
    }

    let releaseLock: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.locks.set(cacheKey, lockPromise);

    return () => {
      this.locks.delete(cacheKey);
      releaseLock();
    };
  }

  /**
   * Read a single partition
   */
  async readPartition<T extends Document>(
    collectionName: string,
    partitionIndex: number
  ): Promise<CollectionData<T> | null> {
    const cacheKey = this.getCacheKey(collectionName, partitionIndex);

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) as CollectionData<T>;
    }

    const filePath = this.getPartitionFilePath(collectionName, partitionIndex);

    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as CollectionData<T>;

      this.cache.set(cacheKey, data as CollectionData<Document>);
      return data;
    } catch (error) {
      throw new StorageError(
        `Failed to read partition ${partitionIndex} for collection "${collectionName}"`,
        error as Error
      );
    }
  }

  /**
   * Write a single partition atomically
   */
  async writePartition<T extends Document>(
    collectionName: string,
    partitionIndex: number,
    data: CollectionData<T>
  ): Promise<void> {
    const filePath = this.getPartitionFilePath(collectionName, partitionIndex);
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    const cacheKey = this.getCacheKey(collectionName, partitionIndex);
    const releaseLock = await this.acquireLock(cacheKey);

    try {
      data.updatedAt = new Date().toISOString();

      const content = this.prettyPrint
        ? JSON.stringify(data, null, 2)
        : JSON.stringify(data);

      await fs.promises.writeFile(tempPath, content, 'utf-8');
      await fs.promises.rename(tempPath, filePath);

      this.cache.set(cacheKey, data as CollectionData<Document>);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }
      throw new StorageError(
        `Failed to write partition ${partitionIndex} for collection "${collectionName}"`,
        error as Error
      );
    } finally {
      releaseLock();
    }
  }

  /**
   * Read all partitions for a collection in parallel
   */
  async readAllPartitions<T extends Document>(
    collectionName: string
  ): Promise<Map<number, CollectionData<T>>> {
    const results = new Map<number, CollectionData<T>>();
    const readPromises: Promise<void>[] = [];

    for (let i = 0; i < this.partitionCount; i++) {
      readPromises.push(
        this.readPartition<T>(collectionName, i).then((data) => {
          if (data) {
            results.set(i, data);
          }
        })
      );
    }

    await Promise.all(readPromises);
    return results;
  }

  /**
   * Write multiple partitions in parallel
   */
  async writePartitions<T extends Document>(
    collectionName: string,
    partitions: Map<number, CollectionData<T>>
  ): Promise<void> {
    const writePromises: Promise<void>[] = [];

    for (const [partitionIndex, data] of partitions) {
      writePromises.push(this.writePartition(collectionName, partitionIndex, data));
    }

    await Promise.all(writePromises);
  }

  /**
   * Initialize empty partitions for a collection
   */
  async initializePartitions(collectionName: string): Promise<void> {
    const initPromises: Promise<void>[] = [];

    for (let i = 0; i < this.partitionCount; i++) {
      const exists = fs.existsSync(this.getPartitionFilePath(collectionName, i));
      if (!exists) {
        const data: CollectionData<Document> = {
          name: collectionName,
          documents: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        initPromises.push(this.writePartition(collectionName, i, data));
      }
    }

    await Promise.all(initPromises);
  }

  /**
   * Get partition info for a collection
   */
  async getPartitionInfo(collectionName: string): Promise<PartitionInfo[]> {
    const partitions = await this.readAllPartitions(collectionName);
    const info: PartitionInfo[] = [];

    for (let i = 0; i < this.partitionCount; i++) {
      const data = partitions.get(i);
      info.push({
        name: this.getPartitionFileName(collectionName, i),
        partitionIndex: i,
        documentCount: data?.documents.length ?? 0,
      });
    }

    return info;
  }

  /**
   * Get all documents from all partitions
   */
  async getAllDocuments<T extends Document>(collectionName: string): Promise<T[]> {
    const partitions = await this.readAllPartitions<T>(collectionName);
    const documents: T[] = [];

    for (const data of partitions.values()) {
      documents.push(...data.documents);
    }

    return documents;
  }

  /**
   * Find document by ID (searches correct partition)
   */
  async findById<T extends Document>(
    collectionName: string,
    documentId: string
  ): Promise<T | null> {
    const partitionIndex = this.getPartitionIndex(documentId);
    const data = await this.readPartition<T>(collectionName, partitionIndex);

    if (!data) return null;

    return data.documents.find((doc) => doc._id === documentId) ?? null;
  }

  /**
   * Delete all partitions for a collection
   */
  async deleteCollection(collectionName: string): Promise<void> {
    const deletePromises: Promise<void>[] = [];

    for (let i = 0; i < this.partitionCount; i++) {
      const filePath = this.getPartitionFilePath(collectionName, i);
      const cacheKey = this.getCacheKey(collectionName, i);

      deletePromises.push(
        (async () => {
          const releaseLock = await this.acquireLock(cacheKey);
          try {
            if (fs.existsSync(filePath)) {
              await fs.promises.unlink(filePath);
            }
            this.cache.delete(cacheKey);
          } finally {
            releaseLock();
          }
        })()
      );
    }

    await Promise.all(deletePromises);
  }

  /**
   * Clear cache for a collection or all collections
   */
  clearCache(collectionName?: string): void {
    if (collectionName) {
      for (let i = 0; i < this.partitionCount; i++) {
        this.cache.delete(this.getCacheKey(collectionName, i));
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get the number of partitions
   */
  getPartitionCount(): number {
    return this.partitionCount;
  }

  /**
   * List all partitioned collections
   */
  async listCollections(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.dataDir);
      const collections = new Set<string>();

      const partitionPattern = new RegExp(`^(.+)_p\\d{3}\\${this.fileExtension}$`);

      for (const file of files) {
        const match = file.match(partitionPattern);
        if (match) {
          collections.add(match[1]);
        }
      }

      return Array.from(collections);
    } catch (error) {
      throw new StorageError('Failed to list partitioned collections', error as Error);
    }
  }
}
