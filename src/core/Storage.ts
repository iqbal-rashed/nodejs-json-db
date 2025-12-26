import * as fs from 'fs';
import * as path from 'path';
import type { Document, CollectionData, StorageAdapter, JsonDBOptions } from '../types';
import { StorageError } from '../errors';

/**
 * File-based storage adapter for JSON data
 */
export class Storage implements StorageAdapter {
  private readonly dataDir: string;
  private readonly fileExtension: string;
  private readonly prettyPrint: boolean;
  private readonly cache: Map<string, CollectionData<Document>> = new Map();
  private readonly locks: Map<string, Promise<void>> = new Map();

  constructor(options: JsonDBOptions) {
    this.dataDir = path.resolve(options.dataDir);
    this.fileExtension = options.fileExtension || '.json';
    this.prettyPrint = options.prettyPrint ?? true;

    // Ensure data directory exists
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
   * Get the file path for a collection
   */
  private getFilePath(collectionName: string): string {
    return path.join(this.dataDir, `${collectionName}${this.fileExtension}`);
  }

  /**
   * Acquire a lock for a collection
   */
  private async acquireLock(collectionName: string): Promise<() => void> {
    // Wait for any existing lock to be released
    while (this.locks.has(collectionName)) {
      await this.locks.get(collectionName);
    }

    // Create a new lock
    let releaseLock: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.locks.set(collectionName, lockPromise);

    return () => {
      this.locks.delete(collectionName);
      releaseLock();
    };
  }

  /**
   * Read collection data from file
   */
  async read<T extends Document>(collectionName: string): Promise<CollectionData<T> | null> {
    // Check cache first
    if (this.cache.has(collectionName)) {
      return this.cache.get(collectionName) as CollectionData<T>;
    }

    const filePath = this.getFilePath(collectionName);

    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as CollectionData<T>;

      // Cache the data
      this.cache.set(collectionName, data as CollectionData<Document>);

      return data;
    } catch (error) {
      throw new StorageError(`Failed to read collection "${collectionName}"`, error as Error);
    }
  }

  /**
   * Write collection data to file atomically
   */
  async write<T extends Document>(collectionName: string, data: CollectionData<T>): Promise<void> {
    const filePath = this.getFilePath(collectionName);
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    const releaseLock = await this.acquireLock(collectionName);

    try {
      // Update timestamp
      data.updatedAt = new Date().toISOString();

      // Serialize data
      const content = this.prettyPrint ? JSON.stringify(data, null, 2) : JSON.stringify(data);

      // Write to temp file first
      await fs.promises.writeFile(tempPath, content, 'utf-8');

      // Atomic rename
      await fs.promises.rename(tempPath, filePath);

      // Update cache
      this.cache.set(collectionName, data as CollectionData<Document>);
    } catch (error) {
      // Clean up temp file on error
      try {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }

      throw new StorageError(`Failed to write collection "${collectionName}"`, error as Error);
    } finally {
      releaseLock();
    }
  }

  /**
   * Check if a collection file exists
   */
  async exists(collectionName: string): Promise<boolean> {
    const filePath = this.getFilePath(collectionName);
    return fs.existsSync(filePath);
  }

  /**
   * Delete a collection file
   */
  async delete(collectionName: string): Promise<void> {
    const filePath = this.getFilePath(collectionName);
    const releaseLock = await this.acquireLock(collectionName);

    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }

      // Remove from cache
      this.cache.delete(collectionName);
    } catch (error) {
      throw new StorageError(`Failed to delete collection "${collectionName}"`, error as Error);
    } finally {
      releaseLock();
    }
  }

  /**
   * List all collection names
   */
  async list(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.dataDir);
      return files
        .filter((file) => file.endsWith(this.fileExtension))
        .map((file) => file.slice(0, -this.fileExtension.length));
    } catch (error) {
      throw new StorageError('Failed to list collections', error as Error);
    }
  }

  /**
   * Clear the cache for a specific collection or all collections
   */
  clearCache(collectionName?: string): void {
    if (collectionName) {
      this.cache.delete(collectionName);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get the data directory path
   */
  getDataDir(): string {
    return this.dataDir;
  }
}
