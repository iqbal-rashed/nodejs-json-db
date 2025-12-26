/**
 * Schema Validation Example
 *
 * This example demonstrates how to use Zod for schema validation
 * with nodejs-json-db.
 *
 * Run with: npx tsx examples/schema-example.ts
 */

import { z } from 'zod';
import { JsonDB, ValidationError } from '../src';

// Define your schema with Zod
const UserSchema = z.object({
  _id: z.string(),
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email format'),
  age: z.number().int().positive().optional(),
  role: z.enum(['admin', 'user', 'guest']).default('user'),
  createdAt: z.string().optional(),
});

// Infer TypeScript type from schema
type User = z.infer<typeof UserSchema>;

async function main() {
  const db = new JsonDB({ dataDir: './.tmp/schema-example' });
  await db.connect();

  // Create a collection WITH schema validation
  const users = db.collection<User>('users', { schema: UserSchema });

  console.log('🔐 Schema Validation Example\n');

  // ✅ Valid insert
  try {
    const user = await users.insert({
      name: 'John Doe',
      email: 'john@example.com',
      age: 30,
      role: 'admin',
    });
    console.log('✅ Valid user inserted:', user);
  } catch (error) {
    console.error('❌ Insert failed:', error);
  }

  // ❌ Invalid insert - missing name
  try {
    await users.insert({
      name: '',
      email: 'jane@example.com',
      role:'admin'
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      console.log('\n❌ Validation failed (empty name):');
      console.log('   Collection:', error.collectionName);
      console.log('   Issues:', error.issues);
    }
  }

  // ❌ Invalid insert - bad email
  try {
    await users.insert({
      name: 'Bob',
      email: 'not-an-email',
      role:'admin'
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      console.log('\n❌ Validation failed (invalid email):');
      console.log('   Issues:', error.issues);
    }
  }

  // ❌ Invalid insert - negative age
  try {
    await users.insert({
      name: 'Alice',
      email: 'alice@example.com',
      age: -5,
      role:'admin'
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      console.log('\n❌ Validation failed (negative age):');
      console.log('   Issues:', error.issues);
    }
  }

  // ✅ Valid insertMany
  try {
    const newUsers = await users.insertMany([
      { name: 'User 1', email: 'user1@example.com', role: 'user' },
      { name: 'User 2', email: 'user2@example.com', role: 'guest' },
    ]);
    console.log('\n✅ Multiple valid users inserted:', newUsers.length);
  } catch (error) {
    console.error('❌ InsertMany failed:', error);
  }

  // List all users
  const allUsers = await users.getAll();
  console.log('\n📋 All users in collection:', allUsers.length);

  await db.close();
  console.log('\n✨ Done!');
}

main().catch(console.error);
