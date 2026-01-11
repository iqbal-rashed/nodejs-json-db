import type { Document, Query, UpdateOperators, FindOptions, Sort, SortOrder } from '../types';
import { LazyStorage } from './LazyStorage';
import { QueryEngine } from './QueryEngine';
import {
  generateId,
  deepClone,
  setNestedValue,
  deleteNestedValue,
  applyProjection,
} from '../utils';
import { DuplicateKeyError, ValidationError } from '../errors';
import type { SchemaValidator } from './Collection';

/**
 * LazyCollection - Memory-efficient collection using lazy loading storage
 *
 * Unlike standard Collection which loads all documents:
 * - Only document IDs are kept in memory
 * - Documents are loaded on-demand with LRU caching
 * - Queries that scan all documents still need to load from disk
 */
export class LazyCollection<T extends Document> {
  private readonly name: string;
  private readonly storage: LazyStorage;
  private readonly queryEngine: QueryEngine;
  private readonly idGenerator: () => string;
  private readonly schema?: SchemaValidator<T>;

  constructor(
    name: string,
    storage: LazyStorage,
    options: {
      idGenerator?: () => string;
      schema?: SchemaValidator<T>;
    } = {}
  ) {
    this.name = name;
    this.storage = storage;
    this.queryEngine = new QueryEngine();
    this.idGenerator = options.idGenerator ?? generateId;
    this.schema = options.schema;
  }

  /**
   * Validate a document against the schema (if defined)
   */
  private validate(doc: unknown): T {
    if (!this.schema) {
      return doc as T;
    }
    const result = this.schema.safeParse(doc);
    if (!result.success) {
      throw new ValidationError(this.name, result.error.issues);
    }
    return result.data;
  }

  /**
   * Insert a single document
   */
  async insert(doc: Omit<T, '_id'> & { _id?: string }): Promise<T> {
    const _id = doc._id || this.idGenerator();

    // Check for duplicate
    if (this.storage.hasDocument(this.name, _id)) {
      throw new DuplicateKeyError(this.name, _id);
    }

    const newDoc = { ...deepClone(doc), _id } as T;
    const validatedDoc = this.validate(newDoc);
    await this.storage.insertDocument(this.name, validatedDoc);
    return deepClone(validatedDoc);
  }

  /**
   * Insert without duplicate check (faster)
   */
  async insertFast(doc: Omit<T, '_id'> & { _id?: string }): Promise<T> {
    const _id = doc._id || this.idGenerator();
    const newDoc = { ...deepClone(doc), _id } as T;
    const validatedDoc = this.validate(newDoc);
    await this.storage.insertDocument(this.name, validatedDoc);
    return deepClone(validatedDoc);
  }

  /**
   * Insert multiple documents
   */
  async insertMany(docs: (Omit<T, '_id'> & { _id?: string })[]): Promise<T[]> {
    if (docs.length === 0) return [];

    const existingIds = new Set(this.storage.getDocumentIds(this.name));
    const insertedDocs: T[] = [];

    for (const doc of docs) {
      const _id = doc._id || this.idGenerator();
      if (existingIds.has(_id)) {
        throw new DuplicateKeyError(this.name, _id);
      }
      existingIds.add(_id);
      const newDoc = { ...deepClone(doc), _id } as T;
      const validatedDoc = this.validate(newDoc);
      insertedDocs.push(validatedDoc);
    }

    await this.storage.insertDocuments(this.name, insertedDocs);
    return insertedDocs.map((doc) => deepClone(doc));
  }

  /**
   * Find documents matching a query
   * Note: This loads documents from disk for filtering
   */
  async find(query?: Query<T>, options?: FindOptions<T>): Promise<T[]> {
    // For empty query with projection only, we can optimize
    // But for filtering, we need to load documents
    const allDocs = await this.storage.getAllDocuments<T>(this.name);
    let results = this.queryEngine.filter(allDocs, query);

    // Apply sort
    if (options?.sort) {
      results = this.sortDocuments(results, options.sort);
    }

    // Apply skip
    if (options?.skip && options.skip > 0) {
      results = results.slice(options.skip);
    }

    // Apply limit
    if (options?.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    // Apply projection
    if (options?.projection) {
      return results.map(
        (doc) =>
          applyProjection(
            deepClone(doc) as Record<string, unknown>,
            options.projection as Record<string, 0 | 1 | boolean>
          ) as T
      );
    }

    return results.map((doc) => deepClone(doc));
  }

  /**
   * Find a single document matching a query
   */
  async findOne(query: Query<T>): Promise<T | null> {
    const results = await this.find(query, { limit: 1 });
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Find a document by ID - optimized, uses cache
   */
  async findById(id: string): Promise<T | null> {
    const doc = await this.storage.getDocument<T>(this.name, id);
    return doc ? deepClone(doc) : null;
  }

  /**
   * Count documents matching a query
   */
  async count(query?: Query<T>): Promise<number> {
    if (!query || Object.keys(query).length === 0) {
      // Optimized - count from index without loading documents
      return this.storage.getCount(this.name);
    }

    const allDocs = await this.storage.getAllDocuments<T>(this.name);
    const results = this.queryEngine.filter(allDocs, query);
    return results.length;
  }

  /**
   * Update documents matching a query
   */
  async update(query: Query<T>, update: UpdateOperators<T> | Partial<T>): Promise<number> {
    const allDocs = await this.storage.getAllDocuments<T>(this.name);
    const matchingDocs = this.queryEngine.filter(allDocs, query);

    if (matchingDocs.length === 0) return 0;

    for (const doc of matchingDocs) {
      this.applyUpdate(doc, update);
      await this.storage.updateDocument(this.name, doc);
    }

    return matchingDocs.length;
  }

  /**
   * Update a single document matching a query
   */
  async updateOne(query: Query<T>, update: UpdateOperators<T> | Partial<T>): Promise<T | null> {
    const allDocs = await this.storage.getAllDocuments<T>(this.name);
    const matchingDocs = this.queryEngine.filter(allDocs, query);

    if (matchingDocs.length === 0) return null;

    const doc = matchingDocs[0];
    this.applyUpdate(doc, update);
    await this.storage.updateDocument(this.name, doc);
    return deepClone(doc);
  }

  /**
   * Update a document by ID - optimized, uses cache
   */
  async updateById(id: string, update: UpdateOperators<T> | Partial<T>): Promise<T | null> {
    const doc = await this.storage.getDocument<T>(this.name, id);
    if (!doc) return null;

    this.applyUpdate(doc, update);
    await this.storage.updateDocument(this.name, doc);
    return deepClone(doc);
  }

  /**
   * Delete documents matching a query
   */
  async delete(query: Query<T>): Promise<number> {
    const allDocs = await this.storage.getAllDocuments<T>(this.name);
    const matchingDocs = this.queryEngine.filter(allDocs, query);

    if (matchingDocs.length === 0) return 0;

    const idsToDelete = matchingDocs.map((doc) => doc._id);
    await this.storage.deleteDocuments(this.name, idsToDelete);
    return matchingDocs.length;
  }

  /**
   * Delete a single document matching a query
   */
  async deleteOne(query: Query<T>): Promise<T | null> {
    const allDocs = await this.storage.getAllDocuments<T>(this.name);
    const matchingDocs = this.queryEngine.filter(allDocs, query);

    if (matchingDocs.length === 0) return null;

    const doc = matchingDocs[0];
    await this.storage.deleteDocument(this.name, doc._id);
    return deepClone(doc);
  }

  /**
   * Delete a document by ID - optimized
   */
  async deleteById(id: string): Promise<T | null> {
    const doc = await this.storage.getDocument<T>(this.name, id);
    if (!doc) return null;

    await this.storage.deleteDocument(this.name, id);
    return deepClone(doc);
  }

  /**
   * Get all documents
   */
  async getAll(): Promise<T[]> {
    return this.find();
  }

  /**
   * Clear all documents
   */
  async clear(): Promise<void> {
    await this.storage.clearCollection(this.name);
  }

  /**
   * Drop the collection
   */
  async drop(): Promise<void> {
    await this.storage.deleteCollection(this.name);
  }

  /**
   * Flush pending writes
   */
  async flush(): Promise<void> {
    await this.storage.flush();
  }

  /**
   * Get collection name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Apply update operators to a document
   */
  private applyUpdate(doc: T, update: UpdateOperators<T> | Partial<T>): void {
    const hasOperators = Object.keys(update).some((key) => key.startsWith('$'));

    if (!hasOperators) {
      Object.assign(doc, update);
      return;
    }

    const ops = update as UpdateOperators<T>;

    if (ops.$set) {
      for (const [key, value] of Object.entries(ops.$set)) {
        if (key === '_id') continue;
        setNestedValue(doc as Record<string, unknown>, key, value);
      }
    }

    if (ops.$unset) {
      for (const key of Object.keys(ops.$unset)) {
        if (key === '_id') continue;
        deleteNestedValue(doc as Record<string, unknown>, key);
      }
    }

    if (ops.$inc) {
      for (const [key, increment] of Object.entries(ops.$inc)) {
        const current = (doc as Record<string, unknown>)[key];
        if (typeof current === 'number' && typeof increment === 'number') {
          (doc as Record<string, unknown>)[key] = current + increment;
        }
      }
    }

    if (ops.$push) {
      for (const [key, value] of Object.entries(ops.$push)) {
        const current = (doc as Record<string, unknown>)[key];
        if (Array.isArray(current)) {
          current.push(value);
        }
      }
    }

    if (ops.$pull) {
      for (const [key, value] of Object.entries(ops.$pull)) {
        const current = (doc as Record<string, unknown>)[key];
        if (Array.isArray(current)) {
          const index = current.findIndex((item) => JSON.stringify(item) === JSON.stringify(value));
          if (index !== -1) {
            current.splice(index, 1);
          }
        }
      }
    }

    if (ops.$addToSet) {
      for (const [key, value] of Object.entries(ops.$addToSet)) {
        const current = (doc as Record<string, unknown>)[key];
        if (Array.isArray(current)) {
          const exists = current.some((item) => JSON.stringify(item) === JSON.stringify(value));
          if (!exists) {
            current.push(value);
          }
        }
      }
    }
  }

  /**
   * Sort documents
   */
  private sortDocuments(documents: T[], sort: Sort<T>): T[] {
    const sortEntries = Object.entries(sort) as [keyof T, SortOrder][];

    return [...documents].sort((a, b) => {
      for (const [field, order] of sortEntries) {
        const aVal = a[field];
        const bVal = b[field];

        let comparison = 0;

        if (aVal === bVal) {
          comparison = 0;
        } else if (aVal === undefined || aVal === null) {
          comparison = 1;
        } else if (bVal === undefined || bVal === null) {
          comparison = -1;
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal;
        } else if (typeof aVal === 'string' && typeof bVal === 'string') {
          comparison = aVal.localeCompare(bVal);
        } else if (aVal instanceof Date && bVal instanceof Date) {
          comparison = aVal.getTime() - bVal.getTime();
        } else {
          comparison = String(aVal).localeCompare(String(bVal));
        }

        if (comparison !== 0) {
          const direction = order === -1 || order === 'desc' ? -1 : 1;
          return comparison * direction;
        }
      }

      return 0;
    });
  }
}
