import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Collection } from '../src/core/Collection';
import { Storage } from '../src/core/Storage';
import type { Document } from '../src/types';

interface TestUser extends Document {
  _id: string;
  name: string;
  email: string;
  age: number;
  active: boolean;
  tags?: string[];
}

describe('Collection', () => {
  let storage: Storage;
  let collection: Collection<TestUser>;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `jsondb-test-${Date.now()}`);
    storage = new Storage({ dataDir: testDir });
    collection = new Collection<TestUser>('users', storage, { autoSave: true });
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('insert', () => {
    it('should insert a single document', async () => {
      const user = await collection.insert({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        active: true,
      });

      expect(user).toHaveProperty('_id');
      expect(user.name).toBe('John Doe');
      expect(user.email).toBe('john@example.com');
      expect(user.age).toBe(30);
      expect(user.active).toBe(true);
    });

    it('should insert with custom ID', async () => {
      const user = await collection.insert({
        _id: 'custom-id',
        name: 'Jane Doe',
        email: 'jane@example.com',
        age: 25,
        active: true,
      });

      expect(user._id).toBe('custom-id');
    });

    it('should throw error on duplicate ID', async () => {
      await collection.insert({
        _id: 'duplicate',
        name: 'User 1',
        email: 'user1@example.com',
        age: 20,
        active: true,
      });

      await expect(
        collection.insert({
          _id: 'duplicate',
          name: 'User 2',
          email: 'user2@example.com',
          age: 25,
          active: true,
        })
      ).rejects.toThrow('Duplicate key error');
    });
  });

  describe('insertMany', () => {
    it('should insert multiple documents', async () => {
      const users = await collection.insertMany([
        { name: 'User 1', email: 'user1@example.com', age: 20, active: true },
        { name: 'User 2', email: 'user2@example.com', age: 25, active: false },
        { name: 'User 3', email: 'user3@example.com', age: 30, active: true },
      ]);

      expect(users).toHaveLength(3);
      expect(users[0]).toHaveProperty('_id');
      expect(users[1]).toHaveProperty('_id');
      expect(users[2]).toHaveProperty('_id');
    });

    it('should return empty array for empty input', async () => {
      const users = await collection.insertMany([]);
      expect(users).toHaveLength(0);
    });
  });

  describe('find', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', email: 'alice@example.com', age: 25, active: true, tags: ['admin'] },
        { name: 'Bob', email: 'bob@example.com', age: 30, active: false, tags: ['user'] },
        {
          name: 'Charlie',
          email: 'charlie@example.com',
          age: 35,
          active: true,
          tags: ['user', 'premium'],
        },
      ]);
    });

    it('should find all documents with no query', async () => {
      const users = await collection.find();
      expect(users).toHaveLength(3);
    });

    it('should find documents with exact match', async () => {
      const users = await collection.find({ name: 'Alice' });
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Alice');
    });

    it('should find documents with multiple conditions', async () => {
      const users = await collection.find({ active: true });
      expect(users).toHaveLength(2);
    });

    it('should support limit option', async () => {
      const users = await collection.find({}, { limit: 2 });
      expect(users).toHaveLength(2);
    });

    it('should support skip option', async () => {
      const users = await collection.find({}, { skip: 1 });
      expect(users).toHaveLength(2);
    });

    it('should support sort option ascending', async () => {
      const users = await collection.find({}, { sort: { age: 1 } });
      expect(users[0].age).toBe(25);
      expect(users[2].age).toBe(35);
    });

    it('should support sort option descending', async () => {
      const users = await collection.find({}, { sort: { age: -1 } });
      expect(users[0].age).toBe(35);
      expect(users[2].age).toBe(25);
    });
  });

  describe('findOne', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'Alice', email: 'alice@example.com', age: 25, active: true },
        { name: 'Bob', email: 'bob@example.com', age: 30, active: false },
      ]);
    });

    it('should find a single document', async () => {
      const user = await collection.findOne({ name: 'Alice' });
      expect(user).not.toBeNull();
      expect(user!.name).toBe('Alice');
    });

    it('should return null if not found', async () => {
      const user = await collection.findOne({ name: 'NonExistent' });
      expect(user).toBeNull();
    });
  });

  describe('findById', () => {
    it('should find document by ID', async () => {
      await collection.insert({
        _id: 'test-id',
        name: 'Test User',
        email: 'test@example.com',
        age: 20,
        active: true,
      });

      const found = await collection.findById('test-id');
      expect(found).not.toBeNull();
      expect(found?._id).toBe('test-id');
      expect(found?.name).toBe('Test User');
    });

    it('should return null for non-existent ID', async () => {
      const found = await collection.findById('non-existent');
      expect(found).toBeNull();
    });
  });

  describe('count', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'User 1', email: 'user1@example.com', age: 20, active: true },
        { name: 'User 2', email: 'user2@example.com', age: 25, active: false },
        { name: 'User 3', email: 'user3@example.com', age: 30, active: true },
      ]);
    });

    it('should count all documents', async () => {
      const count = await collection.count();
      expect(count).toBe(3);
    });

    it('should count with query', async () => {
      const count = await collection.count({ active: true });
      expect(count).toBe(2);
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { _id: 'user-1', name: 'User 1', email: 'user1@example.com', age: 20, active: true },
        { _id: 'user-2', name: 'User 2', email: 'user2@example.com', age: 25, active: true },
        { _id: 'user-3', name: 'User 3', email: 'user3@example.com', age: 30, active: false },
      ]);
    });

    it('should update multiple documents', async () => {
      const count = await collection.update({ active: true }, { $set: { active: false } });
      expect(count).toBe(2);

      const inactive = await collection.count({ active: false });
      expect(inactive).toBe(3);
    });

    it('should update with direct merge', async () => {
      const count = await collection.update({ name: 'User 1' }, { age: 21 });
      expect(count).toBe(1);

      const user = await collection.findById('user-1');
      expect(user!.age).toBe(21);
    });
  });

  describe('updateOne', () => {
    beforeEach(async () => {
      await collection.insert({
        _id: 'user-1',
        name: 'User 1',
        email: 'user1@example.com',
        age: 20,
        active: true,
        tags: ['user'],
      });
    });

    it('should update a single document with $set', async () => {
      const updated = await collection.updateOne({ _id: 'user-1' }, { $set: { age: 25 } });
      expect(updated).not.toBeNull();
      expect(updated!.age).toBe(25);
    });

    it('should update with $inc', async () => {
      const updated = await collection.updateOne({ _id: 'user-1' }, { $inc: { age: 5 } });
      expect(updated!.age).toBe(25);
    });

    it('should update with $push', async () => {
      const updated = await collection.updateOne({ _id: 'user-1' }, { $push: { tags: 'premium' } });
      expect(updated!.tags).toContain('premium');
      expect(updated!.tags).toHaveLength(2);
    });

    it('should update with $pull', async () => {
      const updated = await collection.updateOne({ _id: 'user-1' }, { $pull: { tags: 'user' } });
      expect(updated!.tags).not.toContain('user');
      expect(updated!.tags).toHaveLength(0);
    });

    it('should update with $addToSet', async () => {
      // Add existing value - should not duplicate
      await collection.updateOne({ _id: 'user-1' }, { $addToSet: { tags: 'user' } });
      let user = await collection.findById('user-1');
      expect(user!.tags).toHaveLength(1);

      // Add new value
      await collection.updateOne({ _id: 'user-1' }, { $addToSet: { tags: 'admin' } });
      user = await collection.findById('user-1');
      expect(user!.tags).toHaveLength(2);
    });

    it('should return null if document not found', async () => {
      const updated = await collection.updateOne({ _id: 'non-existent' }, { $set: { age: 30 } });
      expect(updated).toBeNull();
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { name: 'User 1', email: 'user1@example.com', age: 20, active: true },
        { name: 'User 2', email: 'user2@example.com', age: 25, active: true },
        { name: 'User 3', email: 'user3@example.com', age: 30, active: false },
      ]);
    });

    it('should delete multiple documents', async () => {
      const count = await collection.delete({ active: true });
      expect(count).toBe(2);

      const remaining = await collection.count();
      expect(remaining).toBe(1);
    });

    it('should return 0 if no documents match', async () => {
      const count = await collection.delete({ age: 100 });
      expect(count).toBe(0);
    });
  });

  describe('deleteOne', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { _id: 'user-1', name: 'User 1', email: 'user1@example.com', age: 20, active: true },
        { _id: 'user-2', name: 'User 2', email: 'user2@example.com', age: 25, active: true },
      ]);
    });

    it('should delete a single document', async () => {
      const deleted = await collection.deleteOne({ _id: 'user-1' });
      expect(deleted).not.toBeNull();
      expect(deleted!._id).toBe('user-1');

      const remaining = await collection.count();
      expect(remaining).toBe(1);
    });

    it('should return null if document not found', async () => {
      const deleted = await collection.deleteOne({ _id: 'non-existent' });
      expect(deleted).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all documents', async () => {
      await collection.insertMany([
        { name: 'User 1', email: 'user1@example.com', age: 20, active: true },
        { name: 'User 2', email: 'user2@example.com', age: 25, active: true },
      ]);

      await collection.clear();

      const count = await collection.count();
      expect(count).toBe(0);
    });
  });
});
