import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { JsonDB } from '../src/core/JsonDB';
import type { Document } from '../src/types';

interface TestDoc extends Document {
  _id: string;
  value: number;
  data?: string;
}

describe('High-Concurrency Mode', () => {
  let db: JsonDB;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `jsondb-hc-test-${Date.now()}`);
    db = new JsonDB({
      dataDir: testDir,
      highConcurrency: {
        enabled: true,
        partitions: 4,
        batchSize: 100,
        flushInterval: 50,
        maxConcurrentIO: 2,
      },
    });
  });

  afterEach(async () => {
    try {
      await db.close();
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Basic Operations', () => {
    it('should create high-concurrency database', async () => {
      expect(db.isHighConcurrencyMode()).toBe(true);
      await db.connect();
      expect(db.isConnected()).toBe(true);
    });

    it('should insert and find documents', async () => {
      await db.connect();
      const collection = db.collection<TestDoc>('test');

      const doc = await collection.insert({ value: 42 });
      expect(doc._id).toBeDefined();
      expect(doc.value).toBe(42);

      await collection.flush();

      const found = await collection.findById(doc._id);
      expect(found).not.toBeNull();
      expect(found!.value).toBe(42);
    });

    it('should handle bulk inserts', async () => {
      await db.connect();
      const collection = db.collection<TestDoc>('test');

      const docs = Array.from({ length: 100 }, (_, i) => ({ value: i }));
      const inserted = await collection.insertMany(docs);

      expect(inserted).toHaveLength(100);

      await collection.flush();

      const all = await collection.getAll();
      expect(all).toHaveLength(100);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle many parallel inserts', async () => {
      await db.connect();
      const collection = db.collection<TestDoc>('test');

      // Create 1000 parallel insert promises
      const insertPromises = Array.from({ length: 1000 }, (_, i) =>
        collection.insertFast({ value: i })
      );

      await Promise.all(insertPromises);
      await collection.flush();

      const count = await collection.count();
      expect(count).toBe(1000);
    });

    it('should handle concurrent reads and writes', async () => {
      await db.connect();
      const collection = db.collection<TestDoc>('test');

      // Insert some initial data
      await collection.insertMany(Array.from({ length: 100 }, (_, i) => ({ value: i })));
      await collection.flush();

      // Mix of reads and writes
      const operations = [];

      // 500 inserts
      for (let i = 0; i < 500; i++) {
        operations.push(collection.insertFast({ value: 100 + i }));
      }

      // 100 reads interspersed
      for (let i = 0; i < 100; i++) {
        operations.push(collection.find({ value: { $gt: 50 } }));
      }

      await Promise.all(operations);
      await collection.flush();

      const count = await collection.count();
      expect(count).toBe(600); // 100 initial + 500 new
    });

    it('should handle updates without corruption', async () => {
      await db.connect();
      const collection = db.collection<TestDoc>('test');

      // Insert initial document
      const doc = await collection.insert({ value: 0 });
      await collection.flush();

      // Many concurrent updates to the same document
      const updatePromises = Array.from({ length: 100 }, (_, i) =>
        collection.updateById(doc._id, { value: i })
      );

      await Promise.all(updatePromises);
      await collection.flush();

      const updated = await collection.findById(doc._id);
      expect(updated).not.toBeNull();
      // Value should be one of the update values (last one wins due to coalescing)
      expect(typeof updated!.value).toBe('number');
    });

    it('should distribute documents across partitions', async () => {
      await db.connect();
      const collection = db.collection<TestDoc>('test');

      // Insert documents with varied IDs
      const docs = Array.from({ length: 100 }, (_, i) => ({
        _id: `doc-${i}-${Date.now()}`,
        value: i,
      }));

      await collection.insertMany(docs);
      await collection.flush();

      // Check partition files exist
      const files = await fs.promises.readdir(testDir);
      const partitionFiles = files.filter((f) => f.startsWith('test_p'));

      // Should have some partition files (at least 1, up to 4)
      expect(partitionFiles.length).toBeGreaterThan(0);
      expect(partitionFiles.length).toBeLessThanOrEqual(4);
    });
  });

  describe('Data Integrity', () => {
    it('should not lose data during rapid inserts', async () => {
      await db.connect();
      const collection = db.collection<TestDoc>('test');

      const totalDocs = 500;
      const insertPromises = Array.from({ length: totalDocs }, (_, i) =>
        collection.insertFast({ value: i, data: `data-${i}` })
      );

      await Promise.all(insertPromises);
      await collection.flush();

      const all = await collection.getAll();
      expect(all).toHaveLength(totalDocs);

      // Verify all values are present
      const values = new Set(all.map((d) => d.value));
      expect(values.size).toBe(totalDocs);
    });

    it('should preserve data after shutdown and reload', async () => {
      await db.connect();
      const collection = db.collection<TestDoc>('test');

      await collection.insertMany([{ value: 1 }, { value: 2 }, { value: 3 }]);
      await collection.flush();

      // Close and reopen
      await db.close();

      const db2 = new JsonDB({
        dataDir: testDir,
        highConcurrency: {
          enabled: true,
          partitions: 4,
        },
      });

      await db2.connect();
      const collection2 = db2.collection<TestDoc>('test');

      const all = await collection2.getAll();
      expect(all).toHaveLength(3);

      await db2.close();
    });
  });

  describe('Statistics', () => {
    it('should provide stats in high-concurrency mode', async () => {
      await db.connect();

      const stats = db.getStats();
      expect(stats).not.toBeNull();
      expect(stats!.partitions).toBe(4);
      expect(typeof stats!.pendingWrites).toBe('number');
      expect(stats!.workerPool).toBeDefined();
    });
  });
});

describe('Standard Mode (Backward Compatibility)', () => {
  let db: JsonDB;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `jsondb-std-test-${Date.now()}`);
    db = new JsonDB({ dataDir: testDir });
  });

  afterEach(async () => {
    try {
      await db.close();
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should be in standard mode by default', async () => {
    expect(db.isHighConcurrencyMode()).toBe(false);
    expect(db.getStats()).toBeNull();
  });

  it('should work the same as before', async () => {
    await db.connect();
    const collection = db.collection<TestDoc>('test');

    await collection.insert({ value: 1 });
    await collection.insert({ value: 2 });

    const all = await collection.getAll();
    expect(all).toHaveLength(2);
  });
});
