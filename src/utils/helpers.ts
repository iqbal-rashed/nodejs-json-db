/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as T;
  }

  const cloned = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }

  return cloned;
}

/**
 * Get a nested property value from an object using dot notation
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Set a nested property value on an object using dot notation
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
}

/**
 * Delete a nested property from an object using dot notation
 */
export function deleteNestedValue(obj: Record<string, unknown>, path: string): boolean {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      return false;
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey in current) {
    delete current[lastKey];
    return true;
  }

  return false;
}

/**
 * Check if a value is a plain object
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp)
  );
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: unknown, ...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Apply projection to a document
 * Follows MongoDB projection semantics:
 * - Cannot mix inclusion and exclusion (except for _id)
 * - _id is included by default unless explicitly excluded
 * - If projection is empty or undefined, return the full document
 */
export function applyProjection<T extends Record<string, unknown>>(
  doc: T,
  projection?: Record<string, 0 | 1 | boolean>
): Partial<T> {
  if (!projection || Object.keys(projection).length === 0) {
    return doc;
  }

  // Separate _id handling from other fields
  const fields = Object.entries(projection).filter(([key]) => key !== '_id');
  const idProjection = projection._id;

  // Determine if this is an inclusion or exclusion projection
  // (excluding _id from this determination)
  const hasInclusion = fields.some(([, value]) => value === 1 || value === true);
  const hasExclusion = fields.some(([, value]) => value === 0 || value === false);

  // Can't mix inclusion and exclusion (MongoDB behavior)
  if (hasInclusion && hasExclusion) {
    throw new Error('Cannot mix inclusion and exclusion in projection');
  }

  const isInclusion = hasInclusion;
  const result: Partial<T> = {};

  if (isInclusion) {
    // Inclusion mode: only include specified fields
    // _id is included by default unless explicitly excluded
    const includeId = idProjection !== 0 && idProjection !== false;
    if (includeId && '_id' in doc) {
      (result as Record<string, unknown>)._id = doc._id;
    }

    for (const [key, value] of fields) {
      if ((value === 1 || value === true) && key in doc) {
        (result as Record<string, unknown>)[key] = doc[key];
      }
    }
  } else {
    // Exclusion mode: copy all fields except excluded ones
    const excludedFields = new Set(
      fields.filter(([, value]) => value === 0 || value === false).map(([key]) => key)
    );

    // Handle _id exclusion
    const excludeId = idProjection === 0 || idProjection === false;
    if (excludeId) {
      excludedFields.add('_id');
    }

    for (const key of Object.keys(doc)) {
      if (!excludedFields.has(key)) {
        (result as Record<string, unknown>)[key] = doc[key];
      }
    }
  }

  return result;
}
