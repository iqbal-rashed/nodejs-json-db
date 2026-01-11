import * as fs from 'fs';
import * as path from 'path';
import type { Document, CollectionData, JsonDBOptions } from '../types';
import { StorageError } from '../errors';
import { LRUCache } from './LRUCache';

/**
 * Lazy loading options
 */
export interface LazyLoadingOptions {
  /** Enable lazy loading mode */
  enabled: boolean;
  /** Maximum documents to keep in memory cache (default: 1000) */
  cacheSize?: number;
  /** Documents per chunk file for chunking (default: 10000, 0 = no chunking) */
  chunkSize?: number;
}

/**
 * Document index entry - minimal metadata stored in memory
 */
interface DocumentIndex {
  /** Document ID */
  id: string;
  /** Byte offset in file where document starts (for future streaming optimization) */
  offset?: number;
  /** Chunk file index (if using chunking) */
  chunk?: number;
}

/**
 * Collection metadata stored in memory
 */
interface CollectionMeta {
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Document index - only IDs and positions, not full documents */
  index: Map<string, DocumentIndex>;
  /** Total document count */
  count: number;
  /** Whether collection has been modified (needs save) */
  dirty: boolean;
}

/**
 * LazyStorage - Memory-efficient storage adapter
 *
 * Instead of loading all documents into memory:
 * - Keeps only document IDs (index) in memory
 * - Uses LRU cache for frequently accessed documents
 * - Loads full documents on-demand
 * - Supports chunked storage for huge collections
 */
export class LazyStorage {
  private readonly dataDir: string;
  private readonly fileExtension: string;
  private readonly prettyPrint: boolean;
  private readonly cacheSize: number;
  private readonly chunkSize: number;

  /** Document cache per collection: Map<collectionName, LRUCache<docId, document>> */
  private readonly documentCache: Map<string, LRUCache<string, Document>>;

  /** Collection metadata: Map<collectionName, metadata> */
  private readonly collections: Map<string, CollectionMeta>;

  /** Locks for concurrent access */
  private readonly locks: Map<string, Promise<void>>;

  constructor(options: JsonDBOptions) {
    this.dataDir = path.resolve(options.dataDir);
    this.fileExtension = options.fileExtension || '.json';
    this.prettyPrint = options.prettyPrint ?? true;
    this.cacheSize = options.lazyLoading?.cacheSize ?? 1000;
    this.chunkSize = options.lazyLoading?.chunkSize ?? 10000;

    this.documentCache = new Map();
    this.collections = new Map();
    this.locks = new Map();

    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
    } catch (error) {
      throw new StorageError(`Failed to create data directory: ${this.dataDir}`, error as Error);
    }
  }

  private getFilePath(collectionName: string, chunkIndex?: number): string {
    if (chunkIndex !== undefined && this.chunkSize > 0) {
      return path.join(this.dataDir, `${collectionName}_chunk${chunkIndex}${this.fileExtension}`);
    }
    return path.join(this.dataDir, `${collectionName}${this.fileExtension}`);
  }

  private getIndexFilePath(collectionName: string): string {
    return path.join(this.dataDir, `${collectionName}.index${this.fileExtension}`);
  }

  private async acquireLock(collectionName: string): Promise<() => void> {
    while (this.locks.has(collectionName)) {
      await this.locks.get(collectionName);
    }

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
   * Get collection metadata and cache safely (throws if not initialized)
   */
  private getCollectionData(collectionName: string): {
    meta: CollectionMeta;
    cache: LRUCache<string, Document>;
  } {
    const meta = this.collections.get(collectionName);
    const cache = this.documentCache.get(collectionName);
    if (!meta || !cache) {
      throw new StorageError(
        `Collection "${collectionName}" is not initialized`,
        new Error('Not initialized')
      );
    }
    return { meta, cache };
  }

  /**
   * Initialize a collection - loads index only, not documents
   */
  async initCollection(collectionName: string): Promise<void> {
    if (this.collections.has(collectionName)) {
      return;
    }

    const filePath = this.getFilePath(collectionName);
    const indexPath = this.getIndexFilePath(collectionName);

    // Check if index file exists (faster loading)
    if (fs.existsSync(indexPath)) {
      try {
        const indexContent = await fs.promises.readFile(indexPath, 'utf-8');
        const indexData = JSON.parse(indexContent);
        const meta: CollectionMeta = {
          name: collectionName,
          createdAt: indexData.createdAt,
          updatedAt: indexData.updatedAt,
          index: new Map(indexData.ids.map((id: string, i: number) => [id, { id, offset: i }])),
          count: indexData.ids.length,
          dirty: false,
        };
        this.collections.set(collectionName, meta);
        this.documentCache.set(collectionName, new LRUCache<string, Document>(this.cacheSize));
        return;
      } catch {
        // Fall back to reading main file
      }
    }

    // Read main file and build index
    if (fs.existsSync(filePath)) {
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const data = JSON.parse(content) as CollectionData<Document>;

        const index = new Map<string, DocumentIndex>();
        data.documents.forEach((doc, i) => {
          index.set(doc._id, { id: doc._id, offset: i });
        });

        const meta: CollectionMeta = {
          name: collectionName,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          index,
          count: data.documents.length,
          dirty: false,
        };

        this.collections.set(collectionName, meta);
        this.documentCache.set(collectionName, new LRUCache<string, Document>(this.cacheSize));

        // Pre-populate cache with some documents (up to cache size)
        const { cache } = this.getCollectionData(collectionName);
        const docsToCache = Math.min(data.documents.length, this.cacheSize);
        for (let i = 0; i < docsToCache; i++) {
          cache.set(data.documents[i]._id, data.documents[i]);
        }

        // Save index file for faster future loading
        await this.saveIndex(collectionName);
      } catch (error) {
        throw new StorageError(
          `Failed to initialize collection "${collectionName}"`,
          error as Error
        );
      }
    } else {
      // New collection
      const meta: CollectionMeta = {
        name: collectionName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        index: new Map(),
        count: 0,
        dirty: false,
      };
      this.collections.set(collectionName, meta);
      this.documentCache.set(collectionName, new LRUCache<string, Document>(this.cacheSize));
    }
  }

  /**
   * Save index file for fast loading
   */
  private async saveIndex(collectionName: string): Promise<void> {
    const meta = this.collections.get(collectionName);
    if (!meta) return;

    const indexPath = this.getIndexFilePath(collectionName);
    const indexData = {
      name: collectionName,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      ids: Array.from(meta.index.keys()),
    };

    const content = this.prettyPrint
      ? JSON.stringify(indexData, null, 2)
      : JSON.stringify(indexData);
    await fs.promises.writeFile(indexPath, content, 'utf-8');
  }

  /**
   * Get document count without loading documents
   */
  getCount(collectionName: string): number {
    const meta = this.collections.get(collectionName);
    return meta?.count ?? 0;
  }

  /**
   * Check if document exists without loading it
   */
  hasDocument(collectionName: string, docId: string): boolean {
    const meta = this.collections.get(collectionName);
    return meta?.index.has(docId) ?? false;
  }

  /**
   * Get all document IDs without loading documents
   */
  getDocumentIds(collectionName: string): string[] {
    const meta = this.collections.get(collectionName);
    return meta ? Array.from(meta.index.keys()) : [];
  }

  /**
   * Get a single document by ID - uses cache or loads from disk
   */
  async getDocument<T extends Document>(collectionName: string, docId: string): Promise<T | null> {
    await this.initCollection(collectionName);

    const meta = this.collections.get(collectionName);
    if (!meta || !meta.index.has(docId)) {
      return null;
    }

    // Check cache first
    const { cache } = this.getCollectionData(collectionName);
    const cached = cache.get(docId);
    if (cached) {
      return cached as T;
    }

    // Load from file
    const doc = await this.loadDocumentFromDisk<T>(collectionName, docId);
    if (doc) {
      cache.set(docId, doc);
    }
    return doc;
  }

  /**
   * Load document from disk (internal)
   */
  private async loadDocumentFromDisk<T extends Document>(
    collectionName: string,
    docId: string
  ): Promise<T | null> {
    const filePath = this.getFilePath(collectionName);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as CollectionData<T>;
      return data.documents.find((d) => d._id === docId) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get multiple documents by IDs (batch load)
   */
  async getDocuments<T extends Document>(collectionName: string, docIds: string[]): Promise<T[]> {
    await this.initCollection(collectionName);

    const { cache } = this.getCollectionData(collectionName);
    const results: T[] = [];
    const idsToLoad: string[] = [];

    // Check cache first
    for (const id of docIds) {
      const cached = cache.get(id);
      if (cached) {
        results.push(cached as T);
      } else {
        idsToLoad.push(id);
      }
    }

    // Load remaining from disk
    if (idsToLoad.length > 0) {
      const loaded = await this.loadDocumentsFromDisk<T>(collectionName, idsToLoad);
      for (const doc of loaded) {
        cache.set(doc._id, doc);
        results.push(doc);
      }
    }

    return results;
  }

  /**
   * Load multiple documents from disk
   */
  private async loadDocumentsFromDisk<T extends Document>(
    collectionName: string,
    docIds: string[]
  ): Promise<T[]> {
    const filePath = this.getFilePath(collectionName);
    const idSet = new Set(docIds);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as CollectionData<T>;
      return data.documents.filter((d) => idSet.has(d._id));
    } catch {
      return [];
    }
  }

  /**
   * Get all documents (full load - use sparingly for large collections)
   */
  async getAllDocuments<T extends Document>(collectionName: string): Promise<T[]> {
    await this.initCollection(collectionName);

    const filePath = this.getFilePath(collectionName);

    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as CollectionData<T>;

      // Populate cache while we have the data
      const { cache } = this.getCollectionData(collectionName);
      for (const doc of data.documents) {
        cache.set(doc._id, doc);
      }

      return data.documents;
    } catch {
      return [];
    }
  }

  /**
   * Insert a document
   */
  async insertDocument<T extends Document>(collectionName: string, doc: T): Promise<void> {
    await this.initCollection(collectionName);
    const releaseLock = await this.acquireLock(collectionName);

    try {
      const { meta, cache } = this.getCollectionData(collectionName);

      // Add to index
      meta.index.set(doc._id, { id: doc._id, offset: meta.count });
      meta.count++;
      meta.updatedAt = new Date().toISOString();
      meta.dirty = true;

      // Add to cache
      cache.set(doc._id, doc);

      // Write to disk
      await this.persistCollection(collectionName);
    } finally {
      releaseLock();
    }
  }

  /**
   * Insert multiple documents
   */
  async insertDocuments<T extends Document>(collectionName: string, docs: T[]): Promise<void> {
    if (docs.length === 0) return;

    await this.initCollection(collectionName);
    const releaseLock = await this.acquireLock(collectionName);

    try {
      const { meta, cache } = this.getCollectionData(collectionName);

      for (const doc of docs) {
        meta.index.set(doc._id, { id: doc._id, offset: meta.count });
        meta.count++;
        cache.set(doc._id, doc);
      }

      meta.updatedAt = new Date().toISOString();
      meta.dirty = true;

      await this.persistCollection(collectionName);
    } finally {
      releaseLock();
    }
  }

  /**
   * Update a document
   */
  async updateDocument<T extends Document>(collectionName: string, doc: T): Promise<void> {
    await this.initCollection(collectionName);
    const releaseLock = await this.acquireLock(collectionName);

    try {
      const { meta, cache } = this.getCollectionData(collectionName);

      if (!meta.index.has(doc._id)) {
        return;
      }

      // Update cache
      cache.set(doc._id, doc);
      meta.updatedAt = new Date().toISOString();
      meta.dirty = true;

      await this.persistCollection(collectionName);
    } finally {
      releaseLock();
    }
  }

  /**
   * Delete a document
   */
  async deleteDocument(collectionName: string, docId: string): Promise<void> {
    await this.initCollection(collectionName);
    const releaseLock = await this.acquireLock(collectionName);

    try {
      const { meta, cache } = this.getCollectionData(collectionName);

      if (!meta.index.has(docId)) {
        return;
      }

      meta.index.delete(docId);
      meta.count--;
      cache.delete(docId);
      meta.updatedAt = new Date().toISOString();
      meta.dirty = true;

      await this.persistCollection(collectionName);
    } finally {
      releaseLock();
    }
  }

  /**
   * Delete multiple documents
   */
  async deleteDocuments(collectionName: string, docIds: string[]): Promise<void> {
    if (docIds.length === 0) return;

    await this.initCollection(collectionName);
    const releaseLock = await this.acquireLock(collectionName);

    try {
      const { meta, cache } = this.getCollectionData(collectionName);

      for (const docId of docIds) {
        if (meta.index.has(docId)) {
          meta.index.delete(docId);
          meta.count--;
          cache.delete(docId);
        }
      }

      meta.updatedAt = new Date().toISOString();
      meta.dirty = true;

      await this.persistCollection(collectionName);
    } finally {
      releaseLock();
    }
  }

  /**
   * Clear all documents from a collection
   */
  async clearCollection(collectionName: string): Promise<void> {
    await this.initCollection(collectionName);
    const releaseLock = await this.acquireLock(collectionName);

    try {
      const { meta, cache } = this.getCollectionData(collectionName);

      meta.index.clear();
      meta.count = 0;
      cache.clear();
      meta.updatedAt = new Date().toISOString();
      meta.dirty = true;

      await this.persistCollection(collectionName);
    } finally {
      releaseLock();
    }
  }

  /**
   * Persist collection to disk
   */
  private async persistCollection(collectionName: string): Promise<void> {
    const meta = this.collections.get(collectionName);
    if (!meta) return;

    const filePath = this.getFilePath(collectionName);
    const tempPath = `${filePath}.tmp.${Date.now()}`;

    try {
      // Need to load all documents to save (could be optimized with chunking)
      const documents = await this.buildDocumentArray(collectionName);

      const data: CollectionData<Document> = {
        name: collectionName,
        documents,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      };

      const content = this.prettyPrint ? JSON.stringify(data, null, 2) : JSON.stringify(data);
      await fs.promises.writeFile(tempPath, content, 'utf-8');
      await fs.promises.rename(tempPath, filePath);

      // Save index
      await this.saveIndex(collectionName);

      meta.dirty = false;
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }
      throw new StorageError(`Failed to persist collection "${collectionName}"`, error as Error);
    }
  }

  /**
   * Build document array from cache and disk
   */
  private async buildDocumentArray(collectionName: string): Promise<Document[]> {
    const meta = this.collections.get(collectionName);
    if (!meta || meta.count === 0) return [];

    // First, try to get from existing file
    const filePath = this.getFilePath(collectionName);
    let existingDocs: Document[] = [];

    try {
      if (fs.existsSync(filePath)) {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const data = JSON.parse(content) as CollectionData<Document>;
        existingDocs = data.documents;
      }
    } catch {
      // File doesn't exist or is corrupt, use cache only
    }

    // Create map of existing documents
    const docMap = new Map<string, Document>();
    for (const doc of existingDocs) {
      docMap.set(doc._id, doc);
    }

    // Override with cached documents (which may be newer)
    const { cache } = this.getCollectionData(collectionName);
    cache.forEach((doc, id) => {
      docMap.set(id, doc);
    });

    // Only include documents that are in the current index
    const result: Document[] = [];
    for (const id of meta.index.keys()) {
      const doc = docMap.get(id);
      if (doc) {
        result.push(doc);
      }
    }

    return result;
  }

  /**
   * Delete a collection
   */
  async deleteCollection(collectionName: string): Promise<void> {
    const releaseLock = await this.acquireLock(collectionName);

    try {
      this.collections.delete(collectionName);
      this.documentCache.delete(collectionName);

      const filePath = this.getFilePath(collectionName);
      const indexPath = this.getIndexFilePath(collectionName);

      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      if (fs.existsSync(indexPath)) {
        await fs.promises.unlink(indexPath);
      }
    } finally {
      releaseLock();
    }
  }

  /**
   * Check if collection exists
   */
  async exists(collectionName: string): Promise<boolean> {
    if (this.collections.has(collectionName)) {
      return true;
    }
    const filePath = this.getFilePath(collectionName);
    return fs.existsSync(filePath);
  }

  /**
   * List all collections
   */
  async list(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.dataDir);
      const collections = new Set<string>();

      for (const file of files) {
        // Skip index files
        if (file.includes('.index')) continue;
        // Skip chunk files (would be _chunk0, _chunk1, etc)
        if (file.includes('_chunk')) continue;

        if (file.endsWith(this.fileExtension)) {
          collections.add(file.slice(0, -this.fileExtension.length));
        }
      }

      return Array.from(collections);
    } catch {
      return [];
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { collections: number; cachedDocuments: number; cacheSize: number } {
    let cachedDocuments = 0;
    for (const cache of this.documentCache.values()) {
      cachedDocuments += cache.size;
    }

    return {
      collections: this.collections.size,
      cachedDocuments,
      cacheSize: this.cacheSize,
    };
  }

  /**
   * Clear cache for a collection
   */
  clearCache(collectionName?: string): void {
    if (collectionName) {
      this.documentCache.get(collectionName)?.clear();
    } else {
      for (const cache of this.documentCache.values()) {
        cache.clear();
      }
    }
  }

  /**
   * Flush pending writes
   */
  async flush(): Promise<void> {
    for (const [collectionName, meta] of this.collections.entries()) {
      if (meta.dirty) {
        await this.persistCollection(collectionName);
      }
    }
  }

  /**
   * Get data directory path
   */
  getDataDir(): string {
    return this.dataDir;
  }
}
