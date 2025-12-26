import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { JsonDB, ValidationError } from '../src';
import type { Document, SchemaValidator } from '../src';

interface User extends Document {
  _id: string;
  name: string;
  email: string;
  age?: number;
}

// Simple Zod-compatible schema validator for testing
const userSchema: SchemaValidator<User> = {
  safeParse(data: unknown) {
    const obj = data as Record<string, unknown>;
    const issues: Array<{ path: (string | number)[]; message: string; code?: string }> = [];

    if (typeof obj.name !== 'string' || obj.name.length === 0) {
      issues.push({ path: ['name'], message: 'Name is required', code: 'invalid_type' });
    }

    if (typeof obj.email !== 'string' || !obj.email.includes('@')) {
      issues.push({ path: ['email'], message: 'Valid email is required', code: 'invalid_string' });
    }

    if (obj.age !== undefined && (typeof obj.age !== 'number' || obj.age < 0)) {
      issues.push({ path: ['age'], message: 'Age must be a positive number', code: 'invalid_type' });
    }

    if (issues.length > 0) {
      return { success: false as const, error: { issues } };
    }

    return { success: true as const, data: obj as User };
  },
};

describe('Schema Validation', () => {
  let db: JsonDB;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `jsondb-validation-test-${Date.now()}`);
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

  describe('Standard Mode', () => {
    it('should insert valid documents successfully', async () => {
      await db.connect();
      const users = db.collection<User>('users', { schema: userSchema });

      const user = await users.insert({ name: 'John', email: 'john@example.com' });
      expect(user.name).toBe('John');
      expect(user.email).toBe('john@example.com');
    });

    it('should throw ValidationError for invalid documents', async () => {
      await db.connect();
      const users = db.collection<User>('users', { schema: userSchema });

      await expect(
        users.insert({ name: '', email: 'not-an-email' })
      ).rejects.toThrow(ValidationError);
    });

    it('should include validation issues in error', async () => {
      await db.connect();
      const users = db.collection<User>('users', { schema: userSchema });

      try {
        await users.insert({ name: '', email: 'invalid' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        expect(validationError.issues.length).toBeGreaterThan(0);
        expect(validationError.collectionName).toBe('users');
      }
    });

    it('should validate on insertMany', async () => {
      await db.connect();
      const users = db.collection<User>('users', { schema: userSchema });

      await expect(
        users.insertMany([
          { name: 'Valid', email: 'valid@test.com' },
          { name: '', email: 'invalid' },
        ])
      ).rejects.toThrow(ValidationError);
    });

    it('should validate on insertFast', async () => {
      await db.connect();
      const users = db.collection<User>('users', { schema: userSchema });

      await expect(
        users.insertFast({ name: '', email: 'invalid' })
      ).rejects.toThrow(ValidationError);
    });

    it('should work without schema', async () => {
      await db.connect();
      const users = db.collection<User>('users');

      // No schema = no validation
      const user = await users.insert({ name: '', email: 'invalid' });
      expect(user.name).toBe('');
    });
  });

  describe('High-Concurrency Mode', () => {
    let hcDb: JsonDB;
    let hcTestDir: string;

    beforeEach(() => {
      hcTestDir = path.join(os.tmpdir(), `jsondb-hc-validation-test-${Date.now()}`);
      hcDb = new JsonDB({
        dataDir: hcTestDir,
        highConcurrency: { enabled: true, partitions: 2 },
      });
    });

    afterEach(async () => {
      try {
        await hcDb.close();
        await fs.promises.rm(hcTestDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    it('should validate documents in high-concurrency mode', async () => {
      await hcDb.connect();
      const users = hcDb.collection<User>('users', { schema: userSchema });

      await expect(
        users.insert({ name: '', email: 'invalid' })
      ).rejects.toThrow(ValidationError);
    });

    it('should insert valid documents in high-concurrency mode', async () => {
      await hcDb.connect();
      const users = hcDb.collection<User>('users', { schema: userSchema });

      const user = await users.insert({ name: 'Test', email: 'test@example.com', age: 25 });
      expect(user.name).toBe('Test');
      await users.flush();
    });
  });
});
