// Main exports
export { JsonDB } from './core/JsonDB';
export { Collection } from './core/Collection';

// High-concurrency exports
export { HighConcurrencyCollection } from './core/HighConcurrencyCollection';
export { HighConcurrencyStorage } from './core/HighConcurrencyStorage';
export { WriteQueue } from './core/WriteQueue';
export { PartitionManager } from './core/PartitionManager';
export { WorkerPool, parallelLimit } from './core/WorkerPool';

// Schema validator type (for Zod integration)
export type { SchemaValidator } from './core/Collection';

// Types
export type {
  Document,
  Query,
  QueryField,
  ComparisonOperators,
  UpdateOperators,
  FindOptions,
  Sort,
  SortOrder,
  CollectionOptions,
  JsonDBOptions,
  CollectionData,
  StorageAdapter,
  HighConcurrencyOptions,
} from './types';

// Errors
export {
  JsonDBError,
  DocumentNotFoundError,
  DuplicateKeyError,
  ValidationError,
  StorageError,
  CollectionError,
} from './errors';
export type { SchemaIssue } from './errors';

// Utilities
export { generateId, isValidId } from './utils';
