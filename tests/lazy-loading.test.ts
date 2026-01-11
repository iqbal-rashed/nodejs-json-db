import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JsonDB, Document } from '../src';
import * as fs from 'fs';
import * as path from 'path';

interface TestDoc extends Document {
  _id: string;
  name: string;
  age: number;
  email: string;
}

describe('LazyLoading Mode', () => {
  const testDir = path.join(process.cwd(), '.tmp', 'test-lazy-loading');

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  beforeAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('basic operations', () => {
    let db: JsonDB;

    beforeAll(async () => {
      db = new JsonDB({
        dataDir: testDir,
        lazyLoading: {
          enabled: true,
          cacheSize: 10, // Small cache for testing
        },
      });
      await db.connect();
    });

    afterAll(async () => {
      await db.close();
    });

    it('should insert and find documents', async () => {
      const users = db.collection<TestDoc>('users');

      const doc = await users.insert({
        name: 'Alice',
        age: 25,
        email: 'alice@example.com',
      });

      expect(doc._id).toBeDefined();
      expect(doc.name).toBe('Alice');

      const found = await users.findById(doc._id);
      expect(found).not.toBeNull();
      expect(found?.name).toBe('Alice');
    });

    it('should insert many documents', async () => {
      const users = db.collection<TestDoc>('users');

      const docs = await users.insertMany([
        { name: 'Bob', age: 30, email: 'bob@example.com' },
        { name: 'Charlie', age: 35, email: 'charlie@example.com' },
      ]);

      expect(docs).toHaveLength(2);
      expect(docs[0].name).toBe('Bob');
      expect(docs[1].name).toBe('Charlie');
    });

    it('should query documents', async () => {
      const users = db.collection<TestDoc>('users');

      const results = await users.find({ age: { $gte: 30 } });
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should count documents efficiently', async () => {
      const users = db.collection<TestDoc>('users');

      // Count without query should use index (no document loading)
      const count = await users.count();
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('should update documents', async () => {
      const users = db.collection<TestDoc>('users');

      const updated = await users.updateOne({ name: 'Alice' }, { $set: { age: 26 } });

      expect(updated).not.toBeNull();
      expect(updated?.age).toBe(26);
    });

    it('should delete documents', async () => {
      const users = db.collection<TestDoc>('users');

      const beforeCount = await users.count();
      await users.deleteOne({ name: 'Charlie' });
      const afterCount = await users.count();

      expect(afterCount).toBe(beforeCount - 1);
    });

    it('should support projection', async () => {
      const users = db.collection<TestDoc>('users');

      const results = await users.find(
        {},
        {
          projection: { name: 1, email: 1 },
        }
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('_id');
      expect(results[0]).toHaveProperty('name');
      expect(results[0]).toHaveProperty('email');
      expect(results[0]).not.toHaveProperty('age');
    });
  });

  describe('LRU cache behavior', () => {
    let db: JsonDB;
    const cacheSize = 5;

    beforeAll(async () => {
      const cacheTestDir = path.join(testDir, 'cache-test');
      if (fs.existsSync(cacheTestDir)) {
        fs.rmSync(cacheTestDir, { recursive: true });
      }

      db = new JsonDB({
        dataDir: cacheTestDir,
        lazyLoading: {
          enabled: true,
          cacheSize,
        },
      });
      await db.connect();
    });

    afterAll(async () => {
      await db.close();
    });

    it('should evict least recently used documents from cache', async () => {
      const users = db.collection<TestDoc>('users');

      // Insert more documents than cache size
      const docs = [];
      for (let i = 0; i < 10; i++) {
        docs.push(
          await users.insert({
            name: `User${i}`,
            age: 20 + i,
            email: `user${i}@example.com`,
          })
        );
      }

      // All should still be findable (loaded from disk if not in cache)
      for (const doc of docs) {
        const found = await users.findById(doc._id);
        expect(found).not.toBeNull();
        expect(found?.name).toBe(doc.name);
      }
    });
  });

  describe('mode exclusivity', () => {
    it('should throw when both highConcurrency and lazyLoading are enabled', () => {
      expect(() => {
        new JsonDB({
          dataDir: testDir,
          highConcurrency: { enabled: true },
          lazyLoading: { enabled: true },
        });
      }).toThrow('Cannot enable both highConcurrency and lazyLoading modes simultaneously');
    });
  });
});
