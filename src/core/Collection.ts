import type {
  Document,
  Query,
  UpdateOperators,
  CollectionData,
  FindOptions,
  Sort,
  SortOrder,
} from '../types';
import { Storage } from './Storage';
import { QueryEngine } from './QueryEngine';
import { generateId, deepClone, setNestedValue, deleteNestedValue } from '../utils';
import { DuplicateKeyError, ValidationError } from '../errors';

/**
 * Schema validator interface (compatible with Zod)
 */
export interface SchemaValidator<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string; code?: string }> } };
}

/**
 * Collection class for managing documents
 */
export class Collection<T extends Document> {
  private readonly name: string;
  private readonly storage: Storage;
  private readonly queryEngine: QueryEngine;
  private readonly autoSave: boolean;
  private readonly saveDebounce: number;
  private readonly idGenerator: () => string;
  private readonly schema?: SchemaValidator<T>;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingSave: Promise<void> | null = null;

  constructor(
    name: string,
    storage: Storage,
    options: {
      autoSave?: boolean;
      saveDebounce?: number;
      idGenerator?: () => string;
      schema?: SchemaValidator<T>;
    } = {}
  ) {
    this.name = name;
    this.storage = storage;
    this.queryEngine = new QueryEngine();
    this.autoSave = options.autoSave ?? true;
    this.saveDebounce = options.saveDebounce ?? 0;
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
   * Get or create collection data
   */
  private async getData(): Promise<CollectionData<T>> {
    const data = await this.storage.read<T>(this.name);

    if (!data) {
      const newData: CollectionData<T> = {
        name: this.name,
        documents: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.storage.write(this.name, newData);
      return newData;
    }

    return data;
  }

  /**
   * Save collection data with debouncing
   */
  private async save(data: CollectionData<T>): Promise<void> {
    if (!this.autoSave) return;

    if (this.saveDebounce > 0) {
      // Debounced save
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
      }

      return new Promise((resolve) => {
        this.saveTimeout = setTimeout(async () => {
          await this.storage.write(this.name, data);
          this.saveTimeout = null;
          resolve();
        }, this.saveDebounce);
      });
    }

    // Immediate save
    await this.storage.write(this.name, data);
  }

  /**
   * Force save any pending writes
   */
  async flush(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    if (this.pendingSave) {
      await this.pendingSave;
    }

    const data = await this.getData();
    await this.storage.write(this.name, data);
  }

  /**
   * Insert a single document
   */
  async insert(doc: Omit<T, '_id'> & { _id?: string }): Promise<T> {
    const data = await this.getData();

    // Generate ID if not provided
    const _id = doc._id || this.idGenerator();

    // Check for duplicate ID
    if (data.documents.some((d) => d._id === _id)) {
      throw new DuplicateKeyError(this.name, _id);
    }

    const newDoc = { ...deepClone(doc), _id } as T;
    const validatedDoc = this.validate(newDoc);
    data.documents.push(validatedDoc);

    await this.save(data);
    return deepClone(validatedDoc);
  }

  /**
   * Insert a single document without duplicate check (faster)
   * In standard mode, this is equivalent to insert() but skips the duplicate check.
   * Use this when you're certain the ID is unique.
   */
  async insertFast(doc: Omit<T, '_id'> & { _id?: string }): Promise<T> {
    const data = await this.getData();

    const _id = doc._id || this.idGenerator();
    const newDoc = { ...deepClone(doc), _id } as T;
    const validatedDoc = this.validate(newDoc);
    data.documents.push(validatedDoc);

    await this.save(data);
    return deepClone(validatedDoc);
  }

  /**
   * Insert multiple documents
   */
  async insertMany(docs: (Omit<T, '_id'> & { _id?: string })[]): Promise<T[]> {
    if (docs.length === 0) return [];

    const data = await this.getData();
    const insertedDocs: T[] = [];
    const existingIds = new Set(data.documents.map((d) => d._id));

    for (const doc of docs) {
      const _id = doc._id || this.idGenerator();

      if (existingIds.has(_id)) {
        throw new DuplicateKeyError(this.name, _id);
      }

      existingIds.add(_id);
      const newDoc = { ...deepClone(doc), _id } as T;
      const validatedDoc = this.validate(newDoc);
      data.documents.push(validatedDoc);
      insertedDocs.push(deepClone(validatedDoc));
    }

    await this.save(data);
    return insertedDocs;
  }

  /**
   * Find documents matching a query
   */
  async find(query?: Query<T>, options?: FindOptions<T>): Promise<T[]> {
    const data = await this.getData();
    let results = this.queryEngine.filter(data.documents, query);

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
    return this.findOne({ _id: id } as Query<T>);
  }

  /**
   * Count documents matching a query
   */
  async count(query?: Query<T>): Promise<number> {
    const data = await this.getData();
    const results = this.queryEngine.filter(data.documents, query);
    return results.length;
  }

  /**
   * Update documents matching a query
   */
  async update(query: Query<T>, update: UpdateOperators<T> | Partial<T>): Promise<number> {
    const data = await this.getData();
    const matchingDocs = this.queryEngine.filter(data.documents, query);

    if (matchingDocs.length === 0) return 0;

    for (const doc of matchingDocs) {
      this.applyUpdate(doc, update);
    }

    await this.save(data);
    return matchingDocs.length;
  }

  /**
   * Update a single document matching a query
   */
  async updateOne(query: Query<T>, update: UpdateOperators<T> | Partial<T>): Promise<T | null> {
    const data = await this.getData();
    const matchingDocs = this.queryEngine.filter(data.documents, query);

    if (matchingDocs.length === 0) return null;

    const doc = matchingDocs[0];
    this.applyUpdate(doc, update);

    await this.save(data);
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
    const data = await this.getData();
    const initialCount = data.documents.length;

    data.documents = data.documents.filter((doc) => !this.queryEngine.matches(doc, query));

    const deletedCount = initialCount - data.documents.length;

    if (deletedCount > 0) {
      await this.save(data);
    }

    return deletedCount;
  }

  /**
   * Delete a single document matching a query
   */
  async deleteOne(query: Query<T>): Promise<T | null> {
    const data = await this.getData();
    const index = data.documents.findIndex((doc) => this.queryEngine.matches(doc, query));

    if (index === -1) return null;

    const [deleted] = data.documents.splice(index, 1);
    await this.save(data);

    return deepClone(deleted);
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
    const data = await this.getData();
    data.documents = [];
    await this.save(data);
  }

  /**
   * Drop the collection (delete the file)
   */
  async drop(): Promise<void> {
    await this.storage.delete(this.name);
  }

  /**
   * Get the collection name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Apply update operators to a document
   */
  private applyUpdate(doc: T, update: UpdateOperators<T> | Partial<T>): void {
    // Check if it's using operators or direct update
    const hasOperators = Object.keys(update).some((key) => key.startsWith('$'));

    if (!hasOperators) {
      // Direct update (merge)
      Object.assign(doc, update);
      return;
    }

    const ops = update as UpdateOperators<T>;

    // $set - set fields
    if (ops.$set) {
      for (const [key, value] of Object.entries(ops.$set)) {
        if (key === '_id') continue; // Don't allow changing _id
        setNestedValue(doc as Record<string, unknown>, key, value);
      }
    }

    // $unset - remove fields
    if (ops.$unset) {
      for (const key of Object.keys(ops.$unset)) {
        if (key === '_id') continue;
        deleteNestedValue(doc as Record<string, unknown>, key);
      }
    }

    // $inc - increment numeric fields
    if (ops.$inc) {
      for (const [key, increment] of Object.entries(ops.$inc)) {
        const current = (doc as Record<string, unknown>)[key];
        if (typeof current === 'number' && typeof increment === 'number') {
          (doc as Record<string, unknown>)[key] = current + increment;
        }
      }
    }

    // $push - add to array
    if (ops.$push) {
      for (const [key, value] of Object.entries(ops.$push)) {
        const current = (doc as Record<string, unknown>)[key];
        if (Array.isArray(current)) {
          current.push(value);
        }
      }
    }

    // $pull - remove from array
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

    // $addToSet - add to array only if not exists
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
