import type {
  Document,
  Query,
  UpdateOperators,
  FindOptions,
  Sort,
  SortOrder,
} from '../types';
import { HighConcurrencyStorage } from './HighConcurrencyStorage';
import { QueryEngine } from './QueryEngine';
import { generateId, deepClone } from '../utils';
import { DuplicateKeyError, ValidationError } from '../errors';

/**
 * Schema validator interface (compatible with Zod)
 */
export interface SchemaValidator<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string; code?: string }> } };
}

/**
 * HighConcurrencyCollection - Collection class optimized for high-throughput scenarios
 * 
 * Features:
 * - Uses HighConcurrencyStorage for batched, partitioned writes
 * - Same API as regular Collection for compatibility
 * - Optimized for write-heavy workloads
 */
export class HighConcurrencyCollection<T extends Document> {
  private readonly name: string;
  private readonly storage: HighConcurrencyStorage;
  private readonly queryEngine: QueryEngine;
  private readonly idGenerator: () => string;
  private readonly schema?: SchemaValidator<T>;

  constructor(
    name: string,
    storage: HighConcurrencyStorage,
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

    // Check for duplicates (requires flush for consistency)
    const existing = await this.storage.findById<T>(this.name, _id);
    if (existing) {
      throw new DuplicateKeyError(this.name, _id);
    }

    const newDoc = { ...deepClone(doc), _id } as T;
    const validatedDoc = this.validate(newDoc);
    await this.storage.insert(this.name, validatedDoc);
    return validatedDoc;
  }

  /**
   * Insert a single document without duplicate check (faster)
   * Use this when you're certain the ID is unique
   */
  async insertFast(doc: Omit<T, '_id'> & { _id?: string }): Promise<T> {
    const _id = doc._id || this.idGenerator();
    const newDoc = { ...deepClone(doc), _id } as T;
    const validatedDoc = this.validate(newDoc);
    await this.storage.insert(this.name, validatedDoc);
    return validatedDoc;
  }

  /**
   * Insert multiple documents
   */
  async insertMany(docs: (Omit<T, '_id'> & { _id?: string })[]): Promise<T[]> {
    if (docs.length === 0) return [];

    const insertedDocs: T[] = [];
    const newDocs: T[] = [];

    for (const doc of docs) {
      const _id = doc._id || this.idGenerator();
      const newDoc = { ...deepClone(doc), _id } as T;
      const validatedDoc = this.validate(newDoc);
      newDocs.push(validatedDoc);
      insertedDocs.push(deepClone(validatedDoc));
    }

    await this.storage.insertMany(this.name, newDocs);
    return insertedDocs;
  }

  /**
   * Find documents matching a query
   */
  async find(query?: Query<T>, options?: FindOptions<T>): Promise<T[]> {
    const allDocs = await this.storage.readAll<T>(this.name);
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
   * Find a document by ID
   */
  async findById(id: string): Promise<T | null> {
    const doc = await this.storage.findById<T>(this.name, id);
    return doc ? deepClone(doc) : null;
  }

  /**
   * Count documents matching a query
   */
  async count(query?: Query<T>): Promise<number> {
    const allDocs = await this.storage.readAll<T>(this.name);
    const results = this.queryEngine.filter(allDocs, query);
    return results.length;
  }

  /**
   * Update documents matching a query
   */
  async update(query: Query<T>, update: UpdateOperators<T> | Partial<T>): Promise<number> {
    const allDocs = await this.storage.readAll<T>(this.name);
    const matchingDocs = this.queryEngine.filter(allDocs, query);

    if (matchingDocs.length === 0) return 0;

    for (const doc of matchingDocs) {
      const changes = this.getUpdateChanges(doc, update);
      await this.storage.update(this.name, doc._id, changes);
    }

    return matchingDocs.length;
  }

  /**
   * Update a single document matching a query
   */
  async updateOne(query: Query<T>, update: UpdateOperators<T> | Partial<T>): Promise<T | null> {
    const allDocs = await this.storage.readAll<T>(this.name);
    const matchingDocs = this.queryEngine.filter(allDocs, query);

    if (matchingDocs.length === 0) return null;

    const doc = matchingDocs[0];
    const changes = this.getUpdateChanges(doc, update);
    await this.storage.update(this.name, doc._id, changes);

    // Apply changes to doc for return value
    Object.assign(doc, changes);
    return deepClone(doc);
  }

  /**
   * Update a document by ID
   */
  async updateById(id: string, update: UpdateOperators<T> | Partial<T>): Promise<T | null> {
    return this.updateOne({ _id: id } as Query<T>, update);
  }

  /**
   * Delete documents matching a query
   */
  async delete(query: Query<T>): Promise<number> {
    const allDocs = await this.storage.readAll<T>(this.name);
    const matchingDocs = this.queryEngine.filter(allDocs, query);

    if (matchingDocs.length === 0) return 0;

    for (const doc of matchingDocs) {
      await this.storage.delete(this.name, doc._id);
    }

    return matchingDocs.length;
  }

  /**
   * Delete a single document matching a query
   */
  async deleteOne(query: Query<T>): Promise<T | null> {
    const allDocs = await this.storage.readAll<T>(this.name);
    const matchingDocs = this.queryEngine.filter(allDocs, query);

    if (matchingDocs.length === 0) return null;

    const doc = matchingDocs[0];
    await this.storage.delete(this.name, doc._id);
    return deepClone(doc);
  }

  /**
   * Delete a document by ID
   */
  async deleteById(id: string): Promise<T | null> {
    return this.deleteOne({ _id: id } as Query<T>);
  }

  /**
   * Get all documents in the collection
   */
  async getAll(): Promise<T[]> {
    return this.find();
  }

  /**
   * Clear all documents in the collection
   */
  async clear(): Promise<void> {
    await this.storage.clear(this.name);
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
   * Get the collection name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Get update changes from update operators
   */
  private getUpdateChanges(doc: T, update: UpdateOperators<T> | Partial<T>): Partial<T> {
    const hasOperators = Object.keys(update).some((key) => key.startsWith('$'));

    if (!hasOperators) {
      // Direct update (merge)
      return update as Partial<T>;
    }

    const ops = update as UpdateOperators<T>;
    const changes: Record<string, unknown> = {};

    // $set
    if (ops.$set) {
      for (const [key, value] of Object.entries(ops.$set)) {
        if (key === '_id') continue;
        changes[key] = value;
      }
    }

    // $inc
    if (ops.$inc) {
      for (const [key, increment] of Object.entries(ops.$inc)) {
        const current = (doc as Record<string, unknown>)[key];
        if (typeof current === 'number' && typeof increment === 'number') {
          changes[key] = current + increment;
        }
      }
    }

    // $push
    if (ops.$push) {
      for (const [key, value] of Object.entries(ops.$push)) {
        const current = (doc as Record<string, unknown>)[key];
        if (Array.isArray(current)) {
          changes[key] = [...current, value];
        }
      }
    }

    // $pull
    if (ops.$pull) {
      for (const [key, value] of Object.entries(ops.$pull)) {
        const current = (doc as Record<string, unknown>)[key];
        if (Array.isArray(current)) {
          changes[key] = current.filter(
            (item) => JSON.stringify(item) !== JSON.stringify(value)
          );
        }
      }
    }

    // $addToSet
    if (ops.$addToSet) {
      for (const [key, value] of Object.entries(ops.$addToSet)) {
        const current = (doc as Record<string, unknown>)[key];
        if (Array.isArray(current)) {
          const exists = current.some(
            (item) => JSON.stringify(item) === JSON.stringify(value)
          );
          if (!exists) {
            changes[key] = [...current, value];
          } else {
            changes[key] = current;
          }
        }
      }
    }

    return changes as Partial<T>;
  }

  /**
   * Sort documents by the specified sort options
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
