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
  /** Array must contain all specified values */
  $all?: T extends unknown[] ? T : never;
  /** Array element must match the sub-query */
  $elemMatch?: T extends unknown[] ? Record<string, unknown> : never;
  /** Array must have exact length */
  $size?: number;
  /** Value must be of specified type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' */
  $type?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' | 'undefined';
  /** Modulo operation: [divisor, remainder] - matches if value % divisor === remainder */
  $mod?: [number, number];
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
 * Projection specification for field selection
 * Use 1 to include fields, 0 to exclude fields
 * Cannot mix inclusion and exclusion (except _id)
 */
export type Projection<T> = {
  [K in keyof T]?: 0 | 1 | boolean;
} & {
  _id?: 0 | 1 | boolean;
};

/**
 * Options for find operations
 */
export interface FindOptions<T> {
  sort?: Sort<T>;
  limit?: number;
  skip?: number;
  /** Field projection - specify which fields to include/exclude */
  projection?: Projection<T>;
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
 * Lazy loading mode options for memory-efficient storage
 */
export interface LazyLoadingOptions {
  /** Enable lazy loading mode */
  enabled: boolean;
  /** Maximum documents to keep in memory cache (default: 1000) */
  cacheSize?: number;
  /** Documents per chunk file (default: 10000, 0 = no chunking) */
  chunkSize?: number;
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
  /** Lazy loading mode options for memory-efficient storage (opt-in) */
  lazyLoading?: LazyLoadingOptions;
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
