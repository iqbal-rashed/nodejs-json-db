import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Storage } from '../src/core/Storage';
import type { Document, CollectionData } from '../src/types';

interface TestDoc extends Document {
  _id: string;
  value: string;
}

describe('Storage', () => {
  let storage: Storage;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `jsondb-storage-test-${Date.now()}`);
    storage = new Storage({ dataDir: testDir });
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create data directory if it does not exist', () => {
      expect(fs.existsSync(testDir)).toBe(true);
    });

    it('should resolve relative paths to absolute', () => {
      const relativeStorage = new Storage({ dataDir: './.tmp/test-data' });
      expect(path.isAbsolute(relativeStorage.getDataDir())).toBe(true);
    });
  });

  describe('read and write', () => {
    it('should write and read collection data', async () => {
      const data: CollectionData<TestDoc> = {
        name: 'test',
        documents: [{ _id: '1', value: 'hello' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storage.write('test', data);
      const read = await storage.read<TestDoc>('test');

      expect(read).not.toBeNull();
      expect(read!.name).toBe('test');
      expect(read!.documents).toHaveLength(1);
      expect(read!.documents[0].value).toBe('hello');
    });

    it('should return null for non-existent collection', async () => {
      const read = await storage.read('non-existent');
      expect(read).toBeNull();
    });

    it('should update timestamp on write', async () => {
      const data: CollectionData<TestDoc> = {
        name: 'test',
        documents: [],
        createdAt: new Date().toISOString(),
        updatedAt: '2020-01-01T00:00:00.000Z',
      };

      await storage.write('test', data);
      const read = await storage.read<TestDoc>('test');

      expect(read!.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('should pretty print JSON by default', async () => {
      const data: CollectionData<TestDoc> = {
        name: 'test',
        documents: [{ _id: '1', value: 'hello' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storage.write('test', data);

      const filePath = path.join(testDir, 'test.json');
      const content = await fs.promises.readFile(filePath, 'utf-8');
      expect(content).toContain('\n'); // Pretty printed
    });

    it('should not pretty print when option is false', async () => {
      const compactStorage = new Storage({ dataDir: testDir, prettyPrint: false });
      const data: CollectionData<TestDoc> = {
        name: 'test2',
        documents: [{ _id: '1', value: 'hello' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await compactStorage.write('test2', data);

      const filePath = path.join(testDir, 'test2.json');
      const content = await fs.promises.readFile(filePath, 'utf-8');
      expect(content.split('\n')).toHaveLength(1); // Single line
    });
  });

  describe('caching', () => {
    it('should cache read data', async () => {
      const data: CollectionData<TestDoc> = {
        name: 'cached',
        documents: [{ _id: '1', value: 'cached-value' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storage.write('cached', data);

      // Read twice
      const read1 = await storage.read<TestDoc>('cached');
      const read2 = await storage.read<TestDoc>('cached');

      // Both should return the same reference from cache
      expect(read1).toBe(read2);
    });

    it('should clear cache for specific collection', async () => {
      const data: CollectionData<TestDoc> = {
        name: 'cached',
        documents: [{ _id: '1', value: 'value' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storage.write('cached', data);
      await storage.read<TestDoc>('cached'); // Cache it

      storage.clearCache('cached');

      // After clearing, it should read from file again
      const read = await storage.read<TestDoc>('cached');
      expect(read).not.toBeNull();
    });

    it('should clear all cache', async () => {
      const data1: CollectionData<TestDoc> = {
        name: 'collection1',
        documents: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const data2: CollectionData<TestDoc> = {
        name: 'collection2',
        documents: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storage.write('collection1', data1);
      await storage.write('collection2', data2);
      await storage.read<TestDoc>('collection1');
      await storage.read<TestDoc>('collection2');

      storage.clearCache();

      // Both should be re-read from file
      const read1 = await storage.read<TestDoc>('collection1');
      const read2 = await storage.read<TestDoc>('collection2');
      expect(read1).not.toBeNull();
      expect(read2).not.toBeNull();
    });
  });

  describe('exists', () => {
    it('should return true for existing collection', async () => {
      const data: CollectionData<TestDoc> = {
        name: 'exists-test',
        documents: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storage.write('exists-test', data);

      const exists = await storage.exists('exists-test');
      expect(exists).toBe(true);
    });

    it('should return false for non-existing collection', async () => {
      const exists = await storage.exists('non-existing');
      expect(exists).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete collection file', async () => {
      const data: CollectionData<TestDoc> = {
        name: 'to-delete',
        documents: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storage.write('to-delete', data);
      expect(await storage.exists('to-delete')).toBe(true);

      await storage.delete('to-delete');
      expect(await storage.exists('to-delete')).toBe(false);
    });

    it('should not throw when deleting non-existent collection', async () => {
      await expect(storage.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('list', () => {
    it('should list all collection names', async () => {
      const data: CollectionData<TestDoc> = {
        name: 'test',
        documents: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storage.write('collection-a', data);
      await storage.write('collection-b', data);
      await storage.write('collection-c', data);

      const collections = await storage.list();
      expect(collections).toContain('collection-a');
      expect(collections).toContain('collection-b');
      expect(collections).toContain('collection-c');
      expect(collections).toHaveLength(3);
    });

    it('should return empty array for empty directory', async () => {
      const collections = await storage.list();
      expect(collections).toHaveLength(0);
    });
  });

  describe('custom file extension', () => {
    it('should use custom file extension', async () => {
      const customStorage = new Storage({ dataDir: testDir, fileExtension: '.db' });
      const data: CollectionData<TestDoc> = {
        name: 'custom',
        documents: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await customStorage.write('custom', data);

      const filePath = path.join(testDir, 'custom.db');
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
