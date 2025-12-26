/**
 * Base error class for JsonDB errors
 */
export class JsonDBError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonDBError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Error thrown when a document is not found
 */
export class DocumentNotFoundError extends JsonDBError {
  constructor(collectionName: string, id?: string) {
    super(
      id
        ? `Document with id "${id}" not found in collection "${collectionName}"`
        : `Document not found in collection "${collectionName}"`
    );
    this.name = 'DocumentNotFoundError';
  }
}

/**
 * Error thrown when a duplicate key is detected
 */
export class DuplicateKeyError extends JsonDBError {
  constructor(collectionName: string, id: string) {
    super(`Duplicate key error: document with id "${id}" already exists in collection "${collectionName}"`);
    this.name = 'DuplicateKeyError';
  }
}

/**
 * Zod error issue type (subset of ZodIssue for type safety without importing zod)
 */
export interface SchemaIssue {
  path: PropertyKey[];
  message: string;
  code?: string;
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends JsonDBError {
  public readonly collectionName: string;
  public readonly issues: SchemaIssue[];
  public readonly field?: string;
  public readonly value?: unknown;

  constructor(
    collectionName: string,
    issues: SchemaIssue[],
    field?: string,
    value?: unknown
  ) {
    const issueMessages = issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    super(`Validation failed for collection "${collectionName}": ${issueMessages}`);
    this.name = 'ValidationError';
    this.collectionName = collectionName;
    this.issues = issues;
    this.field = field;
    this.value = value;
  }
}

/**
 * Error thrown when storage operations fail
 */
export class StorageError extends JsonDBError {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

/**
 * Error thrown when collection operations fail
 */
export class CollectionError extends JsonDBError {
  constructor(message: string) {
    super(message);
    this.name = 'CollectionError';
  }
}
