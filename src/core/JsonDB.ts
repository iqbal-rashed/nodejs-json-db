import type { Document, JsonDBOptions } from '../types';
import { Storage } from './Storage';
import { Collection } from './Collection';
import { HighConcurrencyStorage } from './HighConcurrencyStorage';
import { HighConcurrencyCollection } from './HighConcurrencyCollection';
import { LazyStorage } from './LazyStorage';
import { LazyCollection } from './LazyCollection';
import { CollectionError } from '../errors';
import type { WorkerPoolStats } from './WorkerPool';

/**
 * Default options for JsonDB
 */
const DEFAULT_OPTIONS: Partial<JsonDBOptions> = {
  autoSave: true,
  saveDebounce: 0,
  prettyPrint: true,
  fileExtension: '.json',
};

/**
 * Collection type union for all modes
 */
export type AnyCollection<T extends Document> =
  | Collection<T>
  | HighConcurrencyCollection<T>
  | LazyCollection<T>;

/**
 * Stats returned by getStats() in high-concurrency mode
 */
interface HighConcurrencyStats {
  pendingWrites: number;
  workerPool: WorkerPoolStats;
  partitions: number;
}

/**
 * JsonDB - A lightweight JSON-based database for Node.js and Electron
 *
 * Supports three modes:
 * - Standard mode: Single-file storage per collection (default)
 * - High-concurrency mode: Partitioned storage with write batching (opt-in)
 * - Lazy loading mode: Memory-efficient with document-level LRU caching (opt-in)
 */
export class JsonDB {
  private readonly options: JsonDBOptions;
  private readonly storage: Storage | null;
  private readonly hcStorage: HighConcurrencyStorage | null;
  private readonly lazyStorage: LazyStorage | null;
  private readonly collections: Map<string, AnyCollection<Document>> = new Map();
  private readonly isHighConcurrency: boolean;
  private readonly isLazyLoading: boolean;
  private connected: boolean = false;

  /**
   * Create a new JsonDB instance
   * @param options Database configuration options
   */
  constructor(options: JsonDBOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.isHighConcurrency = options.highConcurrency?.enabled ?? false;
    this.isLazyLoading = options.lazyLoading?.enabled ?? false;

    // Can't use both high-concurrency and lazy loading at the same time
    if (this.isHighConcurrency && this.isLazyLoading) {
      throw new Error('Cannot enable both highConcurrency and lazyLoading modes simultaneously');
    }

    if (this.isHighConcurrency) {
      this.storage = null;
      this.hcStorage = new HighConcurrencyStorage(this.options);
      this.lazyStorage = null;
    } else if (this.isLazyLoading) {
      this.storage = null;
      this.hcStorage = null;
      this.lazyStorage = new LazyStorage(this.options);
    } else {
      this.storage = new Storage(this.options);
      this.hcStorage = null;
      this.lazyStorage = null;
    }
  }

  /**
   * Get the standard storage (throws if in HC or lazy mode)
   */
  private getStorage(): Storage {
    if (this.storage === null) {
      throw new Error('Storage is not available in high-concurrency or lazy loading mode');
    }
    return this.storage;
  }

  /**
   * Get the high-concurrency storage (throws if in standard or lazy mode)
   */
  private getHCStorage(): HighConcurrencyStorage {
    if (this.hcStorage === null) {
      throw new Error('HighConcurrencyStorage is not available in standard or lazy loading mode');
    }
    return this.hcStorage;
  }

  /**
   * Get the lazy storage (throws if in standard or HC mode)
   */
  private getLazyStorage(): LazyStorage {
    if (this.lazyStorage === null) {
      throw new Error('LazyStorage is not available in standard or high-concurrency mode');
    }
    return this.lazyStorage;
  }

  /**
   * Connect to the database (initialize storage)
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    if (this.isHighConcurrency) {
      // Load existing collections from partitioned storage
      const collectionNames = await this.getHCStorage().listCollections();
      for (const name of collectionNames) {
        this.getOrCreateCollection(name);
      }
    } else if (this.isLazyLoading) {
      // Load existing collections from lazy storage
      const collectionNames = await this.getLazyStorage().list();
      for (const name of collectionNames) {
        this.getOrCreateCollection(name);
      }
    } else {
      // Load existing collections from standard storage
      const collectionNames = await this.getStorage().list();
      for (const name of collectionNames) {
        this.getOrCreateCollection(name);
      }
    }

    this.connected = true;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (!this.connected) return;

    // Flush all pending writes
    for (const collection of this.collections.values()) {
      await collection.flush();
    }

    if (this.isHighConcurrency && this.hcStorage) {
      await this.hcStorage.shutdown();
    }

    this.collections.clear();

    if (this.storage) {
      this.storage.clearCache();
    }
    if (this.hcStorage) {
      this.hcStorage.clearCache();
    }
    if (this.lazyStorage) {
      this.lazyStorage.clearCache();
    }

    this.connected = false;
  }

  /**
   * Get or create a collection
   * @param name Collection name
   * @param options Collection options (including optional Zod schema)
   */
  collection<T extends Document>(
    name: string,
    options?: {
      schema?: {
        safeParse(data: unknown):
          | { success: true; data: T }
          | {
              success: false;
              error: { issues: Array<{ path: PropertyKey[]; message: string; code?: string }> };
            };
      };
    }
  ): AnyCollection<T> {
    if (!name || typeof name !== 'string') {
      throw new CollectionError('Collection name must be a non-empty string');
    }

    // Validate collection name
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) {
      throw new CollectionError(
        'Collection name must start with a letter or underscore and contain only letters, numbers, underscores, and hyphens'
      );
    }

    return this.getOrCreateCollection<T>(name, options);
  }

  /**
   * Get or create a collection internally
   */
  private getOrCreateCollection<T extends Document>(
    name: string,
    options?: {
      schema?: {
        safeParse(data: unknown):
          | { success: true; data: T }
          | {
              success: false;
              error: { issues: Array<{ path: PropertyKey[]; message: string; code?: string }> };
            };
      };
    }
  ): AnyCollection<T> {
    // If collection already exists, return it (schema from first call is used)
    if (this.collections.has(name)) {
      return this.collections.get(name) as AnyCollection<T>;
    }

    if (this.isHighConcurrency) {
      const collection = new HighConcurrencyCollection<T>(name, this.getHCStorage(), {
        schema: options?.schema,
      });
      this.collections.set(name, collection as HighConcurrencyCollection<Document>);
    } else if (this.isLazyLoading) {
      const collection = new LazyCollection<T>(name, this.getLazyStorage(), {
        schema: options?.schema,
      });
      this.collections.set(name, collection as LazyCollection<Document>);
    } else {
      const collection = new Collection<T>(name, this.getStorage(), {
        autoSave: this.options.autoSave,
        saveDebounce: this.options.saveDebounce,
        schema: options?.schema,
      });
      this.collections.set(name, collection as Collection<Document>);
    }

    return this.collections.get(name) as AnyCollection<T>;
  }

  /**
   * Check if a collection exists
   * @param name Collection name
   */
  async hasCollection(name: string): Promise<boolean> {
    if (this.isHighConcurrency) {
      return this.getHCStorage().exists(name);
    }
    return this.getStorage().exists(name);
  }

  /**
   * Get list of all collection names
   */
  async listCollections(): Promise<string[]> {
    if (this.isHighConcurrency) {
      return this.getHCStorage().listCollections();
    }
    return this.getStorage().list();
  }

  /**
   * Drop a collection
   * @param name Collection name
   */
  async dropCollection(name: string): Promise<void> {
    const existingCollection = this.collections.get(name);
    if (existingCollection) {
      await existingCollection.drop();
      this.collections.delete(name);
    } else {
      if (this.isHighConcurrency) {
        await this.getHCStorage().deleteCollection(name);
      } else {
        await this.getStorage().delete(name);
      }
    }
  }

  /**
   * Drop the entire database (delete all collections)
   */
  async drop(): Promise<void> {
    if (this.isHighConcurrency) {
      const hcStorage = this.getHCStorage();
      const collectionNames = await hcStorage.listCollections();
      for (const name of collectionNames) {
        await hcStorage.deleteCollection(name);
      }
    } else {
      const storage = this.getStorage();
      const collectionNames = await storage.list();
      for (const name of collectionNames) {
        await storage.delete(name);
      }
    }
    this.collections.clear();
    this.storage?.clearCache();
    this.hcStorage?.clearCache();
  }

  /**
   * Get the data directory path
   */
  getDataDir(): string {
    if (this.isHighConcurrency) {
      return this.options.dataDir;
    }
    return this.getStorage().getDataDir();
  }

  /**
   * Check if database is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Check if high-concurrency mode is enabled
   */
  isHighConcurrencyMode(): boolean {
    return this.isHighConcurrency;
  }

  /**
   * Get high-concurrency storage statistics
   * Only available in high-concurrency mode
   */
  getStats(): HighConcurrencyStats | null {
    if (!this.isHighConcurrency || !this.hcStorage) {
      return null;
    }
    return this.hcStorage.getStats();
  }

  /**
   * Flush all pending writes
   * Useful in high-concurrency mode to ensure all writes are persisted
   */
  async flush(): Promise<void> {
    for (const collection of this.collections.values()) {
      await collection.flush();
    }
  }
}
