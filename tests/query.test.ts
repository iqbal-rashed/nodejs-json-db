import { describe, it, expect } from 'vitest';
import { QueryEngine } from '../src/core/QueryEngine';
import type { Document } from '../src/types';

interface TestDoc extends Document {
  _id: string;
  name: string;
  age: number;
  email: string;
  active: boolean;
  tags?: string[];
  score?: number;
  nested?: {
    value: string;
    count?: number;
  };
}

describe('QueryEngine', () => {
  const engine = new QueryEngine();

  const testDocs: TestDoc[] = [
    { _id: '1', name: 'Alice', age: 25, email: 'alice@example.com', active: true, tags: ['admin', 'user'], score: 95 },
    { _id: '2', name: 'Bob', age: 30, email: 'bob@example.com', active: false, tags: ['user'], score: 80 },
    { _id: '3', name: 'Charlie', age: 35, email: 'charlie@test.com', active: true, tags: ['guest'], score: 70 },
    { _id: '4', name: 'Diana', age: 28, email: 'diana@example.com', active: true, tags: ['user', 'premium'] },
    { _id: '5', name: 'Eve', age: 22, email: 'eve@example.com', active: false, nested: { value: 'test', count: 5 } },
  ];

  describe('exact match', () => {
    it('should match exact string values', () => {
      const results = engine.filter(testDocs, { name: 'Alice' });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('1');
    });

    it('should match exact number values', () => {
      const results = engine.filter(testDocs, { age: 30 });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('2');
    });

    it('should match exact boolean values', () => {
      const results = engine.filter(testDocs, { active: true });
      expect(results).toHaveLength(3);
    });

    it('should return all docs with empty query', () => {
      const results = engine.filter(testDocs, {});
      expect(results).toHaveLength(5);
    });

    it('should return all docs with undefined query', () => {
      const results = engine.filter(testDocs);
      expect(results).toHaveLength(5);
    });
  });

  describe('$eq operator', () => {
    it('should match with $eq', () => {
      const results = engine.filter(testDocs, { name: { $eq: 'Bob' } });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('2');
    });
  });

  describe('$ne operator', () => {
    it('should exclude with $ne', () => {
      const results = engine.filter(testDocs, { active: { $ne: true } });
      expect(results).toHaveLength(2);
    });
  });

  describe('$gt and $gte operators', () => {
    it('should filter with $gt', () => {
      const results = engine.filter(testDocs, { age: { $gt: 28 } });
      expect(results).toHaveLength(2); // Bob (30) and Charlie (35)
    });

    it('should filter with $gte', () => {
      const results = engine.filter(testDocs, { age: { $gte: 28 } });
      expect(results).toHaveLength(3); // Diana (28), Bob (30), Charlie (35)
    });
  });

  describe('$lt and $lte operators', () => {
    it('should filter with $lt', () => {
      const results = engine.filter(testDocs, { age: { $lt: 25 } });
      expect(results).toHaveLength(1); // Eve (22)
    });

    it('should filter with $lte', () => {
      const results = engine.filter(testDocs, { age: { $lte: 25 } });
      expect(results).toHaveLength(2); // Alice (25), Eve (22)
    });
  });

  describe('$in operator', () => {
    it('should match if value is in array', () => {
      const results = engine.filter(testDocs, { name: { $in: ['Alice', 'Bob', 'Unknown'] } });
      expect(results).toHaveLength(2);
    });

    it('should return empty if no match', () => {
      const results = engine.filter(testDocs, { name: { $in: ['Unknown1', 'Unknown2'] } });
      expect(results).toHaveLength(0);
    });
  });

  describe('$nin operator', () => {
    it('should exclude if value is in array', () => {
      const results = engine.filter(testDocs, { name: { $nin: ['Alice', 'Bob'] } });
      expect(results).toHaveLength(3);
    });
  });

  describe('$exists operator', () => {
    it('should match if field exists', () => {
      const results = engine.filter(testDocs, { score: { $exists: true } });
      expect(results).toHaveLength(3); // Alice, Bob, Charlie have score
    });

    it('should match if field does not exist', () => {
      const results = engine.filter(testDocs, { score: { $exists: false } });
      expect(results).toHaveLength(2); // Diana, Eve don't have score
    });
  });

  describe('$regex operator', () => {
    it('should match with regex string', () => {
      const results = engine.filter(testDocs, { email: { $regex: '@example\\.com$' } });
      expect(results).toHaveLength(4);
    });

    it('should match with RegExp object', () => {
      const results = engine.filter(testDocs, { email: { $regex: /@test\.com$/ } });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('3');
    });
  });

  describe('$startsWith operator', () => {
    it('should match strings that start with value', () => {
      const results = engine.filter(testDocs, { name: { $startsWith: 'A' } });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice');
    });
  });

  describe('$endsWith operator', () => {
    it('should match strings that end with value', () => {
      const results = engine.filter(testDocs, { name: { $endsWith: 'e' } });
      expect(results).toHaveLength(3); // Alice, Charlie, Eve
    });
  });

  describe('$contains operator', () => {
    it('should match arrays containing value', () => {
      const results = engine.filter(testDocs, { tags: { $contains: 'admin' } });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('1');
    });
  });

  describe('$and operator', () => {
    it('should match all conditions', () => {
      const results = engine.filter(testDocs, {
        $and: [{ active: true }, { age: { $gte: 25 } }],
      });
      expect(results).toHaveLength(3); // Alice, Charlie, Diana
    });
  });

  describe('$or operator', () => {
    it('should match any condition', () => {
      const results = engine.filter(testDocs, {
        $or: [{ name: 'Alice' }, { name: 'Bob' }],
      });
      expect(results).toHaveLength(2);
    });
  });

  describe('$not operator', () => {
    it('should negate the condition', () => {
      const results = engine.filter(testDocs, {
        $not: { active: true },
      });
      expect(results).toHaveLength(2); // Bob, Eve
    });
  });

  describe('combined operators', () => {
    it('should handle multiple operators on same field', () => {
      const results = engine.filter(testDocs, {
        age: { $gte: 25, $lte: 30 },
      });
      expect(results).toHaveLength(3); // Alice (25), Diana (28), Bob (30)
    });

    it('should handle multiple field conditions', () => {
      const results = engine.filter(testDocs, {
        active: true,
        age: { $lt: 30 },
      });
      expect(results).toHaveLength(2); // Alice (25), Diana (28)
    });
  });

  describe('nested field access', () => {
    it('should access nested fields with dot notation', () => {
      const results = engine.filter(testDocs, { 'nested.value': 'test' });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('5');
    });

    it('should handle nested field with operators', () => {
      const results = engine.filter(testDocs, { 'nested.count': { $gt: 3 } });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('5');
    });
  });
});
