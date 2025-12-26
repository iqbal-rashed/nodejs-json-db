/**
 * Base document type - all documents must have an _id field
 */
export interface Document {
  _id: string;
  [key: string]: unknown;
}

/**
 * Query comparison operators
 */
export interface ComparisonOperators<T> {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  $in?: T[];
  $nin?: T[];
  $regex?: RegExp | string;
  $exists?: boolean;
  $startsWith?: string;
  $endsWith?: string;
  $contains?: T extends unknown[] ? T[number] : never;
}

/**
 * Field-level query type
 */
export type QueryField<T> = T | ComparisonOperators<T>;

/**
 * Query type for finding documents
 */
export type Query<T> = {
  [K in keyof T]?: QueryField<T[K]>;
} & {
  $and?: Query<T>[];
  $or?: Query<T>[];
  $not?: Query<T>;
};

/**
 * Update operators for modifying documents
 */
export interface UpdateOperators<T> {
  $set?: Partial<T>;
  $unset?: { [K in keyof T]?: true };
  $inc?: { [K in keyof T]?: T[K] extends number ? number : never };
  $push?: { [K in keyof T]?: T[K] extends unknown[] ? T[K][number] : never };
  $pull?: { [K in keyof T]?: T[K] extends unknown[] ? T[K][number] : never };
  $addToSet?: { [K in keyof T]?: T[K] extends unknown[] ? T[K][number] : never };
}

/**
 * Sort order for query results
 */
export type SortOrder = 1 | -1 | 'asc' | 'desc';

/**
 * Sort specification
 */
export type Sort<T> = {
  [K in keyof T]?: SortOrder;
};

/**
 * Options for find operations
 */
export interface FindOptions<T> {
  sort?: Sort<T>;
  limit?: number;
  skip?: number;
}

/**
 * Collection configuration options
 */
export interface CollectionOptions {
  /** Name of the collection */
  name: string;
  /** Custom ID generator function */
  idGenerator?: () => string;
}

/**
 * High-concurrency mode options
 */
export interface HighConcurrencyOptions {
  /** Enable high-concurrency mode (default: false) */
  enabled: boolean;
  /** Number of partitions for data sharding (default: 16) */
  partitions?: number;
  /** Maximum writes before automatic flush (default: 1000) */
  batchSize?: number;
  /** Maximum time in ms before automatic flush (default: 100) */
  flushInterval?: number;
  /** Maximum concurrent I/O operations (default: 4) */
  maxConcurrentIO?: number;
  /** Whether to coalesce duplicate writes (default: true) */
  coalesceWrites?: boolean;
}

/**
 * JsonDB configuration options
 */
export interface JsonDBOptions {
  /** Path to the database directory */
  dataDir: string;
  /** Whether to auto-save after each write operation (default: true) */
  autoSave?: boolean;
  /** Debounce time in ms for auto-save (default: 0) */
  saveDebounce?: number;
  /** Whether to pretty print JSON files (default: true) */
  prettyPrint?: boolean;
  /** Custom file extension (default: .json) */
  fileExtension?: string;
  /** High-concurrency mode options (opt-in) */
  highConcurrency?: HighConcurrencyOptions;
}

/**
 * Internal collection data structure
 */
export interface CollectionData<T extends Document = Document> {
  name: string;
  documents: T[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Storage adapter interface
 */
export interface StorageAdapter {
  read<T extends Document>(collectionName: string): Promise<CollectionData<T> | null>;
  write<T extends Document>(collectionName: string, data: CollectionData<T>): Promise<void>;
  exists(collectionName: string): Promise<boolean>;
  delete(collectionName: string): Promise<void>;
  list(): Promise<string[]>;
}

