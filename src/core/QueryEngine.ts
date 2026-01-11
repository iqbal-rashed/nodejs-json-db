import type { Document, Query, ComparisonOperators } from '../types';
import { getNestedValue, isPlainObject } from '../utils';

/**
 * Query engine for filtering documents based on MongoDB-like queries
 */
export class QueryEngine {
  /**
   * Filter an array of documents based on a query
   */
  filter<T extends Document>(documents: T[], query?: Query<T>): T[] {
    if (!query || Object.keys(query).length === 0) {
      return documents;
    }

    return documents.filter((doc) => this.matches(doc, query));
  }

  /**
   * Check if a document matches a query
   */
  matches<T extends Document>(document: T, query: Query<T>): boolean {
    // Handle logical operators
    if ('$and' in query && query.$and) {
      return query.$and.every((subQuery) => this.matches(document, subQuery));
    }

    if ('$or' in query && query.$or) {
      return query.$or.some((subQuery) => this.matches(document, subQuery));
    }

    if ('$not' in query && query.$not) {
      return !this.matches(document, query.$not);
    }

    // Check each field in the query
    for (const [field, condition] of Object.entries(query)) {
      if (field.startsWith('$')) continue; // Skip operators we've already handled

      const value = getNestedValue(document, field);

      if (!this.matchesCondition(value, condition)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a value matches a condition
   */
  private matchesCondition(value: unknown, condition: unknown): boolean {
    // Direct equality check
    if (!isPlainObject(condition) || !this.hasOperators(condition)) {
      return this.isEqual(value, condition);
    }

    // Handle operators
    const operators = condition as ComparisonOperators<unknown>;

    if ('$eq' in operators) {
      if (!this.isEqual(value, operators.$eq)) return false;
    }

    if ('$ne' in operators) {
      if (this.isEqual(value, operators.$ne)) return false;
    }

    if ('$gt' in operators) {
      if (!this.compareValues(value, operators.$gt, '>')) return false;
    }

    if ('$gte' in operators) {
      if (!this.compareValues(value, operators.$gte, '>=')) return false;
    }

    if ('$lt' in operators) {
      if (!this.compareValues(value, operators.$lt, '<')) return false;
    }

    if ('$lte' in operators) {
      if (!this.compareValues(value, operators.$lte, '<=')) return false;
    }

    if ('$in' in operators && Array.isArray(operators.$in)) {
      if (!operators.$in.some((item) => this.isEqual(value, item))) return false;
    }

    if ('$nin' in operators && Array.isArray(operators.$nin)) {
      if (operators.$nin.some((item) => this.isEqual(value, item))) return false;
    }

    if ('$exists' in operators) {
      const exists = value !== undefined && value !== null;
      if (operators.$exists !== exists) return false;
    }

    if ('$regex' in operators) {
      if (typeof value !== 'string') return false;
      const regex =
        operators.$regex instanceof RegExp
          ? operators.$regex
          : new RegExp(operators.$regex as string);
      if (!regex.test(value)) return false;
    }

    if ('$startsWith' in operators) {
      if (typeof value !== 'string' || typeof operators.$startsWith !== 'string') return false;
      if (!value.startsWith(operators.$startsWith)) return false;
    }

    if ('$endsWith' in operators) {
      if (typeof value !== 'string' || typeof operators.$endsWith !== 'string') return false;
      if (!value.endsWith(operators.$endsWith)) return false;
    }

    if ('$contains' in operators) {
      if (!Array.isArray(value)) return false;
      if (!value.some((item) => this.isEqual(item, operators.$contains))) return false;
    }

    // $all - array must contain all specified values
    if ('$all' in operators && Array.isArray(operators.$all)) {
      if (!Array.isArray(value)) return false;
      if (!operators.$all.every((item) => value.some((v) => this.isEqual(v, item)))) return false;
    }

    // $elemMatch - at least one array element must match the sub-query
    if ('$elemMatch' in operators && operators.$elemMatch) {
      if (!Array.isArray(value)) return false;
      const subQuery = operators.$elemMatch as Record<string, unknown>;
      const hasMatch = value.some((item) => {
        if (typeof item !== 'object' || item === null) return false;
        // For each key in the sub-query, check if the item matches
        return Object.entries(subQuery).every(([key, condition]) => {
          const itemValue = (item as Record<string, unknown>)[key];
          return this.matchesCondition(itemValue, condition);
        });
      });
      if (!hasMatch) return false;
    }

    // $size - array must have exact length
    if ('$size' in operators && typeof operators.$size === 'number') {
      if (!Array.isArray(value)) return false;
      if (value.length !== operators.$size) return false;
    }

    // $type - value must be of specified type
    if ('$type' in operators && operators.$type) {
      const expectedType = operators.$type;
      let actualType: string;

      if (value === null) {
        actualType = 'null';
      } else if (value === undefined) {
        actualType = 'undefined';
      } else if (Array.isArray(value)) {
        actualType = 'array';
      } else {
        actualType = typeof value;
      }

      if (actualType !== expectedType) return false;
    }

    // $mod - modulo operation: value % divisor === remainder
    if ('$mod' in operators && Array.isArray(operators.$mod) && operators.$mod.length === 2) {
      if (typeof value !== 'number') return false;
      const [divisor, remainder] = operators.$mod as [number, number];
      if (value % divisor !== remainder) return false;
    }

    return true;
  }

  /**
   * Check if a condition object has any operators
   */
  private hasOperators(condition: Record<string, unknown>): boolean {
    return Object.keys(condition).some((key) => key.startsWith('$'));
  }

  /**
   * Deep equality check
   */
  private isEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (a === undefined || b === undefined) return a === b;

    if (typeof a !== typeof b) return false;

    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, index) => this.isEqual(item, b[index]));
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const aKeys = Object.keys(a as object);
      const bKeys = Object.keys(b as object);
      if (aKeys.length !== bKeys.length) return false;
      return aKeys.every((key) =>
        this.isEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
      );
    }

    return false;
  }

  /**
   * Compare two values with the specified operator
   */
  private compareValues(a: unknown, b: unknown, operator: '>' | '>=' | '<' | '<='): boolean {
    if (typeof a === 'number' && typeof b === 'number') {
      switch (operator) {
        case '>':
          return a > b;
        case '>=':
          return a >= b;
        case '<':
          return a < b;
        case '<=':
          return a <= b;
      }
    }

    if (typeof a === 'string' && typeof b === 'string') {
      switch (operator) {
        case '>':
          return a > b;
        case '>=':
          return a >= b;
        case '<':
          return a < b;
        case '<=':
          return a <= b;
      }
    }

    if (a instanceof Date && b instanceof Date) {
      switch (operator) {
        case '>':
          return a.getTime() > b.getTime();
        case '>=':
          return a.getTime() >= b.getTime();
        case '<':
          return a.getTime() < b.getTime();
        case '<=':
          return a.getTime() <= b.getTime();
      }
    }

    return false;
  }
}

/**
 * Singleton instance of the query engine
 */
export const queryEngine = new QueryEngine();
