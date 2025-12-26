import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { JsonDB } from '../src/core/JsonDB';
import type { Document } from '../src/types';

interface User extends Document {
  _id: string;
  name: string;
  email: string;
  age: number;
}

interface Post extends Document {
  _id: string;
  title: string;
  content: string;
  authorId: string;
}

describe('Integration Tests', () => {
  let db: JsonDB;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `jsondb-integration-${Date.now()}`);
    db = new JsonDB({ dataDir: testDir });
  });

  afterEach(async () => {
    await db.close();
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Database lifecycle', () => {
    it('should connect and disconnect', async () => {
      expect(db.isConnected()).toBe(false);
      await db.connect();
      expect(db.isConnected()).toBe(true);
      await db.close();
      expect(db.isConnected()).toBe(false);
    });

    it('should create data directory on connect', async () => {
      await db.connect();
      expect(fs.existsSync(testDir)).toBe(true);
    });
  });

  describe('Collection management', () => {
    it('should create and list collections', async () => {
      await db.connect();

      const users = db.collection<User>('users');
      await users.insert({ name: 'Test', email: 'test@test.com', age: 20 });

      const posts = db.collection<Post>('posts');
      await posts.insert({ title: 'Hello', content: 'World', authorId: '123' });

      const collections = await db.listCollections();
      expect(collections).toContain('users');
      expect(collections).toContain('posts');
    });

    it('should check if collection exists', async () => {
      await db.connect();

      const users = db.collection<User>('users');
      await users.insert({ name: 'Test', email: 'test@test.com', age: 20 });

      expect(await db.hasCollection('users')).toBe(true);
      expect(await db.hasCollection('non-existent')).toBe(false);
    });

    it('should drop a collection', async () => {
      await db.connect();

      const users = db.collection<User>('users');
      await users.insert({ name: 'Test', email: 'test@test.com', age: 20 });

      await db.dropCollection('users');

      expect(await db.hasCollection('users')).toBe(false);
    });

    it('should validate collection names', async () => {
      expect(() => db.collection('')).toThrow();
      expect(() => db.collection('123invalid')).toThrow();
      expect(() => db.collection('valid_name')).not.toThrow();
      expect(() => db.collection('valid-name')).not.toThrow();
      expect(() => db.collection('_private')).not.toThrow();
    });
  });

  describe('Full workflow', () => {
    it('should handle complete CRUD workflow', async () => {
      await db.connect();

      const users = db.collection<User>('users');

      // Create
      const user1 = await users.insert({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
      });
      expect(user1._id).toBeDefined();

      const user2 = await users.insert({
        name: 'Jane Doe',
        email: 'jane@example.com',
        age: 25,
      });

      // Read
      const all = await users.find();
      expect(all).toHaveLength(2);

      const found = await users.findById(user1._id);
      expect(found!.name).toBe('John Doe');

      // Update
      await users.updateById(user1._id, { $set: { age: 31 } });
      const updated = await users.findById(user1._id);
      expect(updated!.age).toBe(31);

      // Delete
      await users.deleteById(user2._id);
      const remaining = await users.count();
      expect(remaining).toBe(1);
    });

    it('should persist data across sessions', async () => {
      await db.connect();

      const users = db.collection<User>('users');
      await users.insert({
        name: 'Persistent User',
        email: 'persist@example.com',
        age: 35,
      });

      await db.close();

      // Create new DB instance
      const db2 = new JsonDB({ dataDir: testDir });
      await db2.connect();

      const users2 = db2.collection<User>('users');
      const found = await users2.findOne({ name: 'Persistent User' });
      expect(found).not.toBeNull();
      expect(found!.email).toBe('persist@example.com');

      await db2.close();
    });

    it('should handle complex queries', async () => {
      await db.connect();

      const users = db.collection<User>('users');
      await users.insertMany([
        { name: 'Alice', email: 'alice@example.com', age: 20 },
        { name: 'Bob', email: 'bob@example.com', age: 25 },
        { name: 'Charlie', email: 'charlie@example.com', age: 30 },
        { name: 'Diana', email: 'diana@example.com', age: 35 },
        { name: 'Eve', email: 'eve@example.com', age: 40 },
      ]);

      // Complex query
      const results = await users.find(
        {
          $or: [{ age: { $lt: 25 } }, { age: { $gte: 35 } }],
        },
        {
          sort: { age: -1 },
        }
      );

      expect(results).toHaveLength(3); // Alice (20), Diana (35), Eve (40)
      expect(results[0].name).toBe('Eve'); // Sorted descending
      expect(results[2].name).toBe('Alice');
    });

    it('should handle multiple collections with relationships', async () => {
      await db.connect();

      const users = db.collection<User>('users');
      const posts = db.collection<Post>('posts');

      // Create user
      const user = await users.insert({
        name: 'Author',
        email: 'author@example.com',
        age: 30,
      });

      // Create posts for user
      await posts.insertMany([
        { title: 'Post 1', content: 'Content 1', authorId: user._id },
        { title: 'Post 2', content: 'Content 2', authorId: user._id },
        { title: 'Post 3', content: 'Content 3', authorId: user._id },
      ]);

      // Find user's posts
      const userPosts = await posts.find({ authorId: user._id });
      expect(userPosts).toHaveLength(3);

      // Delete user and their posts
      await users.deleteById(user._id);
      await posts.delete({ authorId: user._id });

      expect(await users.count()).toBe(0);
      expect(await posts.count()).toBe(0);
    });
  });

  describe('Drop database', () => {
    it('should drop all collections', async () => {
      await db.connect();

      const users = db.collection<User>('users');
      await users.insert({ name: 'Test', email: 'test@test.com', age: 20 });

      const posts = db.collection<Post>('posts');
      await posts.insert({ title: 'Test', content: 'Content', authorId: '1' });

      await db.drop();

      const collections = await db.listCollections();
      expect(collections).toHaveLength(0);
    });
  });
});
