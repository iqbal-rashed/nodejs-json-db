import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JsonDB, Document } from '../src';
import * as fs from 'fs';
import * as path from 'path';

interface TestDoc extends Document {
  _id: string;
  name: string;
  age: number;
  email: string;
  active: boolean;
  tags?: string[];
  score?: number;
  items?: { name: string; qty: number; price: number }[];
  nested?: {
    value: string;
    count?: number;
  };
}

describe('Advanced Query Operators', () => {
  const testDir = path.join(process.cwd(), '.tmp', 'test-advanced-query');
  let db: JsonDB;

  const testDocs: Omit<TestDoc, '_id'>[] = [
    {
      name: 'Alice',
      age: 25,
      email: 'alice@example.com',
      active: true,
      tags: ['admin', 'user', 'premium'],
      score: 95,
    },
    {
      name: 'Bob',
      age: 30,
      email: 'bob@example.com',
      active: false,
      tags: ['user'],
      score: 80,
      items: [
        { name: 'Widget', qty: 5, price: 10 },
        { name: 'Gadget', qty: 10, price: 25 },
      ],
    },
    {
      name: 'Charlie',
      age: 35,
      email: 'charlie@test.com',
      active: true,
      tags: ['guest'],
      score: 70,
      items: [{ name: 'Widget', qty: 2, price: 10 }],
    },
    { name: 'Diana', age: 28, email: 'diana@example.com', active: true, tags: ['user', 'premium'] },
    {
      name: 'Eve',
      age: 22,
      email: 'eve@example.com',
      active: false,
      nested: { value: 'test', count: 5 },
    },
  ];

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    db = new JsonDB({ dataDir: testDir });
    await db.connect();
    const users = db.collection<TestDoc>('users');
    await users.insertMany(testDocs as (Omit<TestDoc, '_id'> & { _id?: string })[]);
  });

  afterAll(async () => {
    await db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('$all operator', () => {
    it('should match if array contains all specified values', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ tags: { $all: ['user', 'premium'] } });
      expect(results).toHaveLength(2); // Alice and Diana
      expect(results.map((r) => r.name).sort()).toEqual(['Alice', 'Diana']);
    });

    it('should not match if array is missing any value', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({
        tags: { $all: ['user', 'admin', 'premium', 'superadmin'] },
      });
      expect(results).toHaveLength(0);
    });

    it('should match single value', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ tags: { $all: ['guest'] } });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Charlie');
    });
  });

  describe('$elemMatch operator', () => {
    it('should match if any array element matches the sub-query', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ items: { $elemMatch: { qty: { $gt: 5 } } } });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Bob');
    });

    it('should match with multiple conditions in sub-query', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({
        items: { $elemMatch: { name: 'Widget', qty: { $gte: 2 } } },
      });
      expect(results).toHaveLength(2); // Bob and Charlie have Widget with qty >= 2
    });

    it('should not match if no element satisfies all conditions', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({
        items: { $elemMatch: { name: 'Widget', qty: { $gt: 10 } } },
      });
      expect(results).toHaveLength(0);
    });
  });

  describe('$size operator', () => {
    it('should match arrays with exact length', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ tags: { $size: 3 } });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice');
    });

    it('should match arrays with specified size', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ tags: { $size: 1 } });
      expect(results).toHaveLength(2); // Bob and Charlie both have 1 tag
      expect(results.map((r) => r.name).sort()).toEqual(['Bob', 'Charlie']);
    });

    it('should not match non-arrays', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ name: { $size: 5 } as unknown });
      expect(results).toHaveLength(0);
    });
  });

  describe('$type operator', () => {
    it('should match string type', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ name: { $type: 'string' } });
      expect(results).toHaveLength(5);
    });

    it('should match number type', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ age: { $type: 'number' } });
      expect(results).toHaveLength(5);
    });

    it('should match boolean type', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ active: { $type: 'boolean' } });
      expect(results).toHaveLength(5);
    });

    it('should match array type', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ tags: { $type: 'array' } });
      expect(results).toHaveLength(4); // Eve doesn't have tags
    });

    it('should match object type for nested fields', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ nested: { $type: 'object' } });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Eve');
    });
  });

  describe('$mod operator', () => {
    it('should match modulo operation', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ age: { $mod: [5, 0] } }); // age divisible by 5
      expect(results).toHaveLength(3); // 25, 30, 35
    });

    it('should match with specific remainder', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ age: { $mod: [10, 2] } }); // age % 10 === 2
      expect(results).toHaveLength(1); // 22
      expect(results[0].name).toBe('Eve');
    });

    it('should not match non-numbers', async () => {
      const users = db.collection<TestDoc>('users');
      const results = await users.find({ name: { $mod: [2, 0] } as unknown });
      expect(results).toHaveLength(0);
    });
  });
});

describe('Projection Support', () => {
  const testDir = path.join(process.cwd(), '.tmp', 'test-projection');
  let db: JsonDB;

  interface User extends Document {
    _id: string;
    name: string;
    email: string;
    password: string;
    age: number;
    role: string;
  }

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    db = new JsonDB({ dataDir: testDir });
    await db.connect();
    const users = db.collection<User>('users');
    await users.insertMany([
      { name: 'Alice', email: 'alice@example.com', password: 'secret1', age: 25, role: 'admin' },
      { name: 'Bob', email: 'bob@example.com', password: 'secret2', age: 30, role: 'user' },
    ] as Omit<User, '_id'>[]);
  });

  afterAll(async () => {
    await db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('inclusion mode', () => {
    it('should include only specified fields', async () => {
      const users = db.collection<User>('users');
      const results = await users.find({}, { projection: { name: 1, email: 1 } });
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('_id');
      expect(results[0]).toHaveProperty('name');
      expect(results[0]).toHaveProperty('email');
      expect(results[0]).not.toHaveProperty('password');
      expect(results[0]).not.toHaveProperty('age');
    });

    it('should exclude _id when explicitly set to 0', async () => {
      const users = db.collection<User>('users');
      const results = await users.find({}, { projection: { name: 1, _id: 0 } });
      expect(results[0]).not.toHaveProperty('_id');
      expect(results[0]).toHaveProperty('name');
    });
  });

  describe('exclusion mode', () => {
    it('should exclude specified fields', async () => {
      const users = db.collection<User>('users');
      const results = await users.find({}, { projection: { password: 0 } });
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('_id');
      expect(results[0]).toHaveProperty('name');
      expect(results[0]).toHaveProperty('email');
      expect(results[0]).toHaveProperty('age');
      expect(results[0]).not.toHaveProperty('password');
    });

    it('should exclude multiple fields', async () => {
      const users = db.collection<User>('users');
      const results = await users.find({}, { projection: { password: 0, role: 0 } });
      expect(results[0]).not.toHaveProperty('password');
      expect(results[0]).not.toHaveProperty('role');
      expect(results[0]).toHaveProperty('name');
    });

    it('should exclude _id when set to 0', async () => {
      const users = db.collection<User>('users');
      const results = await users.find({}, { projection: { _id: 0, password: 0 } });
      expect(results[0]).not.toHaveProperty('_id');
      expect(results[0]).not.toHaveProperty('password');
    });
  });

  describe('edge cases', () => {
    it('should return full document with empty projection', async () => {
      const users = db.collection<User>('users');
      const results = await users.find({}, { projection: {} });
      expect(results[0]).toHaveProperty('_id');
      expect(results[0]).toHaveProperty('name');
      expect(results[0]).toHaveProperty('password');
    });

    it('should work with query and projection together', async () => {
      const users = db.collection<User>('users');
      const results = await users.find({ name: 'Alice' }, { projection: { name: 1, role: 1 } });
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('name', 'Alice');
      expect(results[0]).toHaveProperty('role', 'admin');
      expect(results[0]).not.toHaveProperty('password');
    });

    it('should throw error when mixing inclusion and exclusion', async () => {
      const users = db.collection<User>('users');
      await expect(users.find({}, { projection: { name: 1, password: 0 } })).rejects.toThrow(
        'Cannot mix inclusion and exclusion in projection'
      );
    });
  });
});
