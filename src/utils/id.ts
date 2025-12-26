import { ObjectId } from 'bson';

/**
 * Generate a unique ID using bson ObjectId
 * @param _length - Ignored, kept for backward compatibility
 * @returns A 24-character hexadecimal string
 */
export function generateId(_length?: number): string {
  return new ObjectId().toHexString();
}

/**
 * Check if a value is a valid ID
 * Supports both ObjectId (24 hex chars) and custom IDs (1-64 chars)
 */
export function isValidId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
    return false;
  }

  // Check if it's a valid ObjectId format
  if (id.length === 24) {
    return ObjectId.isValid(id);
  }

  // Accept other string formats for custom IDs
  return true;
}

