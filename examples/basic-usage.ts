/**
 * Basic Usage Example
 *
 * This example demonstrates the fundamental operations of nodejs-json-db:
 * - Creating a database connection
 * - Inserting documents
 * - Querying documents
 * - Updating documents
 * - Deleting documents
 *
 * Run with: npx tsx examples/basic-usage.ts
 */

import { JsonDB, Document } from '../src';
import * as path from 'path';

// Define your document types
interface User extends Document {
  _id: string;
  name: string;
  email: string;
  age: number;
  role: 'admin' | 'user' | 'guest';
  createdAt: string;
}

async function main() {
  // Create a new database instance
  const db = new JsonDB({
    dataDir: path.join(__dirname, './data'),
    prettyPrint: true, // Format JSON files for readability
  });

  // Connect to the database
  await db.connect();
  console.log('Connected to database at:', db.getDataDir());

  // Get a typed collection
  const users = db.collection<User>('users');

  // Clear any existing data for this example
  await users.clear();

  console.log('\n--- Insert Operations ---');

  // Insert a single document
  const user1 = await users.insert({
    name: 'John Doe',
    email: 'john@example.com',
    age: 30,
    role: 'admin',
    createdAt: new Date().toISOString(),
  });
  console.log('Inserted user:', user1);

  // Insert multiple documents
  const newUsers = await users.insertMany([
    { name: 'Jane Smith', email: 'jane@example.com', age: 25, role: 'user', createdAt: new Date().toISOString() },
    { name: 'Bob Wilson', email: 'bob@example.com', age: 35, role: 'user', createdAt: new Date().toISOString() },
    { name: 'Alice Brown', email: 'alice@example.com', age: 28, role: 'guest', createdAt: new Date().toISOString() },
  ]);
  console.log(`Inserted ${newUsers.length} more users`);

  console.log('\n--- Query Operations ---');

  // Find all documents
  const allUsers = await users.find();
  console.log(`Total users: ${allUsers.length}`);

  // Find with query
  const admins = await users.find({ role: 'admin' });
  console.log('Admin users:', admins.map((u) => u.name));

  // Find one document
  const john = await users.findOne({ name: 'John Doe' });
  console.log('Found John:', john?.email);

  // Find by ID
  const foundById = await users.findById(user1._id);
  console.log('Found by ID:', foundById?.name);

  // Count documents
  const userCount = await users.count({ role: 'user' });
  console.log('Users with role "user":', userCount);

  console.log('\n--- Update Operations ---');

  // Update a single document
  const updated = await users.updateOne({ name: 'John Doe' }, { $set: { age: 31 } });
  console.log('Updated John\'s age to:', updated?.age);

  // Update by ID
  await users.updateById(user1._id, { $set: { role: 'user' } });
  const johnAfterUpdate = await users.findById(user1._id);
  console.log('John\'s new role:', johnAfterUpdate?.role);

  // Update multiple documents
  const updatedCount = await users.update({ role: 'user' }, { $inc: { age: 1 } });
  console.log(`Incremented age for ${updatedCount} users`);

  console.log('\n--- Delete Operations ---');

  // Delete a single document
  const deleted = await users.deleteOne({ name: 'Alice Brown' });
  console.log('Deleted:', deleted?.name);

  // Count remaining
  const remaining = await users.count();
  console.log('Remaining users:', remaining);

  // Close the database
  await db.close();
  console.log('\nDatabase closed');
}

main().catch(console.error);
