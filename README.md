# nodejs-json-db

[![npm version](https://img.shields.io/npm/v/nodejs-json-db.svg)](https://www.npmjs.com/package/nodejs-json-db)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

A production-ready, lightweight JSON-based database for Node.js and Electron applications. Zero external database dependencies, fully typed, with a MongoDB-like query API. Supports three storage modes: Standard, High-Concurrency, and Lazy Loading.

## ✨ Features

- 🚀 **Zero Dependencies** - No external database server required
- 📦 **Dual Module Support** - Works with both ESM and CommonJS
- 🔒 **Type-Safe** - Full TypeScript support with generics
- 🔍 **MongoDB-like Queries** - Rich query operators (`$eq`, `$gt`, `$in`, `$regex`, `$all`, `$elemMatch`, etc.)
- 🎯 **Field Projection** - Select which fields to return in queries
- ⚡ **High Performance** - Memory caching with atomic file writes
- 🔄 **High-Concurrency Mode** - Partitioned storage with write batching for massive throughput
- 💾 **Lazy Loading Mode** - Memory-efficient storage for huge datasets with LRU caching
- ✅ **Schema Validation** - Optional Zod integration for document validation
- 🖥️ **Electron Ready** - Perfect for desktop applications
- 🧪 **Well Tested** - 141 tests with comprehensive coverage

## 📦 Installation

```bash
npm install nodejs-json-db
```

```bash
yarn add nodejs-json-db
```

For schema validation (optional):

```bash
npm install zod
```

## 🚀 Quick Start

```typescript
import { JsonDB, Document } from 'nodejs-json-db';

interface User extends Document {
  _id: string;
  name: string;
  email: string;
  age: number;
}

const db = new JsonDB({ dataDir: './data' });
await db.connect();

const users = db.collection<User>('users');

// Insert
const user = await users.insert({
  name: 'John Doe',
  email: 'john@example.com',
  age: 30,
});

// Find
const found = await users.findOne({ email: 'john@example.com' });

// Update
await users.updateById(user._id, { $set: { age: 31 } });

// Delete
await users.deleteById(user._id);

await db.close();
```

## 📊 Benchmarks

Performance tested with documents up to 1 million records:

### Write Performance (insertMany)

| Documents | Standard Mode           | High-Concurrency Mode          |
| --------- | ----------------------- | ------------------------------ |
| 100,000   | 390K docs/sec (56 MB/s) | 355K docs/sec (51 MB/s)        |
| 500,000   | 382K docs/sec (55 MB/s) | **423K docs/sec (61 MB/s)** ✅ |
| 1,000,000 | 392K docs/sec (56 MB/s) | **392K docs/sec (56 MB/s)**    |

### Read Performance (find)

| Documents | Standard Mode            | High-Concurrency Mode           |
| --------- | ------------------------ | ------------------------------- |
| 1,000     | 648K docs/sec (93 MB/s)  | **803K docs/sec (115 MB/s)** ✅ |
| 10,000    | 1.5M docs/sec (218 MB/s) | **2.2M docs/sec (309 MB/s)** ✅ |
| 100,000+  | **2.8M+ docs/sec**       | 2.0M docs/sec                   |

Run benchmarks yourself:

```bash
npx tsx examples/benchmark.ts
```

## 🔄 High-Concurrency Mode

For applications handling thousands of concurrent requests, enable high-concurrency mode:

```typescript
const db = new JsonDB({
  dataDir: './data',
  highConcurrency: {
    enabled: true,
    partitions: 16, // Data shards (default: 16)
    batchSize: 1000, // Writes before auto-flush (default: 1000)
    flushInterval: 100, // Max ms before flush (default: 100)
    maxConcurrentIO: 4, // Parallel I/O operations (default: 4)
  },
});

await db.connect();
const users = db.collection('users');

// Fast parallel inserts (skips duplicate check)
await Promise.all(
  Array.from({ length: 10000 }, (_, i) =>
    users.insertFast({ name: `User ${i}`, email: `user${i}@test.com` })
  )
);

// Always flush before shutdown
await db.flush();
await db.close();
```

### When to Use High-Concurrency Mode

| Use Case                             | Recommended Mode   |
| ------------------------------------ | ------------------ |
| Desktop apps, small datasets         | Standard           |
| Web servers with concurrent requests | High-Concurrency   |
| Bulk data import                     | Either (both fast) |
| Real-time applications               | High-Concurrency   |

## 💾 Lazy Loading Mode

For applications with huge datasets that don't fit in memory, enable lazy loading mode:

```typescript
const db = new JsonDB({
  dataDir: './data',
  lazyLoading: {
    enabled: true,
    cacheSize: 1000, // Max documents in memory (default: 1000)
    chunkSize: 10000, // Future: documents per chunk file
  },
});

await db.connect();
const users = db.collection('users');

// Documents are loaded on-demand with LRU caching
const user = await users.findById('some-id'); // Efficient - uses cache
const count = await users.count(); // Efficient - uses index only

// Queries still work but load documents from disk
const results = await users.find({ age: { $gt: 25 } });

await db.close();
```

### How It Works

- **Index in memory**: Only document IDs are kept in memory
- **LRU cache**: Frequently accessed documents are cached (up to `cacheSize`)
- **On-demand loading**: Full documents are loaded from disk when needed
- **ID-based optimization**: `findById()` and `count()` are optimized

### When to Use Lazy Loading Mode

| Use Case                       | Recommended Mode |
| ------------------------------ | ---------------- |
| Small datasets (< 10K docs)    | Standard         |
| Medium datasets                | Standard or Lazy |
| Huge datasets (> 100K docs)    | Lazy Loading     |
| Memory-constrained environment | Lazy Loading     |
| Frequent full queries          | Standard         |
| ID-based access patterns       | Lazy Loading     |

## ✅ Schema Validation (Zod)

Validate documents before insertion using Zod schemas:

```typescript
import { z } from 'zod';
import { JsonDB, ValidationError } from 'nodejs-json-db';

const UserSchema = z.object({
  _id: z.string(),
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});

type User = z.infer<typeof UserSchema>;

const db = new JsonDB({ dataDir: './data' });
await db.connect();

// Pass schema when creating collection
const users = db.collection<User>('users', { schema: UserSchema });

// ✅ Valid - inserts successfully
await users.insert({ name: 'John', email: 'john@example.com' });

// ❌ Invalid - throws ValidationError
try {
  await users.insert({ name: '', email: 'not-an-email' });
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.issues); // [{path: ['name'], message: '...'}, ...]
  }
}
```

## 📖 API Reference

### JsonDB Options

| Option            | Type      | Default      | Description                                |
| ----------------- | --------- | ------------ | ------------------------------------------ |
| `dataDir`         | `string`  | **required** | Path to store JSON files                   |
| `autoSave`        | `boolean` | `true`       | Auto-save after writes                     |
| `saveDebounce`    | `number`  | `0`          | Debounce time (ms) for saves               |
| `prettyPrint`     | `boolean` | `true`       | Format JSON files                          |
| `fileExtension`   | `string`  | `.json`      | Custom file extension                      |
| `highConcurrency` | `object`  | `undefined`  | Enable high-concurrency mode               |
| `lazyLoading`     | `object`  | `undefined`  | Enable lazy loading mode for huge datasets |

### JsonDB Methods

```typescript
await db.connect();                    // Initialize database
await db.close();                      // Close connection
db.collection<T>('name', {schema?});   // Get typed collection
await db.listCollections();            // List all collections
await db.hasCollection('name');        // Check if exists
await db.dropCollection('name');       // Delete collection
await db.drop();                       // Delete all collections
await db.flush();                      // Flush pending writes
db.isHighConcurrencyMode();            // Check mode
db.getStats();                         // Get HC stats (if enabled)
```

### Collection Methods

```typescript
// Insert
await collection.insert(doc);            // With duplicate check
await collection.insertFast(doc);        // Skip duplicate check (faster)
await collection.insertMany(docs);       // Bulk insert

// Find
await collection.find(query?, options?); // Find matching docs
await collection.findOne(query);         // Find first match
await collection.findById(id);           // Find by ID
await collection.count(query?);          // Count matches
await collection.getAll();               // Get all documents

// Update
await collection.update(query, update);     // Update many
await collection.updateOne(query, update);  // Update first match
await collection.updateById(id, update);    // Update by ID

// Delete
await collection.delete(query);          // Delete many
await collection.deleteOne(query);       // Delete first match
await collection.deleteById(id);         // Delete by ID
await collection.clear();                // Clear all documents
await collection.drop();                 // Drop collection

// Utility
await collection.flush();                // Force save pending writes
collection.getName();                    // Get collection name
```

## 🔍 Query Operators

### Comparison

| Operator       | Example                               |
| -------------- | ------------------------------------- |
| `$eq`          | `{ age: { $eq: 25 } }`                |
| `$ne`          | `{ status: { $ne: 'deleted' } }`      |
| `$gt` / `$gte` | `{ age: { $gte: 18 } }`               |
| `$lt` / `$lte` | `{ price: { $lt: 100 } }`             |
| `$in` / `$nin` | `{ role: { $in: ['admin', 'mod'] } }` |

### String

| Operator      | Example                                 |
| ------------- | --------------------------------------- |
| `$regex`      | `{ email: { $regex: /@gmail\.com$/ } }` |
| `$startsWith` | `{ name: { $startsWith: 'John' } }`     |
| `$endsWith`   | `{ email: { $endsWith: '.com' } }`      |

### Array

| Operator     | Description               | Example                                          |
| ------------ | ------------------------- | ------------------------------------------------ |
| `$contains`  | Array contains value      | `{ tags: { $contains: 'admin' } }`               |
| `$all`       | Array contains all values | `{ tags: { $all: ['user', 'premium'] } }`        |
| `$elemMatch` | Element matches sub-query | `{ items: { $elemMatch: { qty: { $gt: 5 } } } }` |
| `$size`      | Array has exact length    | `{ tags: { $size: 3 } }`                         |

### Utility

| Operator  | Description      | Example                        |
| --------- | ---------------- | ------------------------------ |
| `$type`   | Value type check | `{ age: { $type: 'number' } }` |
| `$mod`    | Modulo operation | `{ qty: { $mod: [4, 0] } }`    |
| `$exists` | Field exists     | `{ email: { $exists: true } }` |

### Logical

```typescript
// AND (implicit)
{ active: true, age: { $gte: 18 } }

// OR
{ $or: [{ role: 'admin' }, { role: 'mod' }] }

// NOT
{ $not: { status: 'deleted' } }
```

## 🎯 Projection

Select which fields to return in query results:

```typescript
// Include only specific fields (_id included by default)
await users.find({}, { projection: { name: 1, email: 1 } });

// Exclude specific fields
await users.find({}, { projection: { password: 0, secret: 0 } });

// Exclude _id
await users.find({}, { projection: { name: 1, _id: 0 } });
```

> **Note:** Cannot mix inclusion and exclusion (except for `_id`).

## 📝 Update Operators

| Operator    | Description       | Example                             |
| ----------- | ----------------- | ----------------------------------- |
| `$set`      | Set field         | `{ $set: { name: 'New' } }`         |
| `$unset`    | Remove field      | `{ $unset: { temp: true } }`        |
| `$inc`      | Increment         | `{ $inc: { views: 1 } }`            |
| `$push`     | Add to array      | `{ $push: { tags: 'new' } }`        |
| `$pull`     | Remove from array | `{ $pull: { tags: 'old' } }`        |
| `$addToSet` | Add unique        | `{ $addToSet: { tags: 'unique' } }` |

## 🖥️ Electron Integration

```typescript
import { app } from 'electron';
import { JsonDB } from 'nodejs-json-db';
import path from 'path';

const db = new JsonDB({
  dataDir: path.join(app.getPath('userData'), 'database'),
});

await db.connect();
```

## 📁 Data Storage

Standard mode stores one JSON file per collection:

```
data/
├── users.json
├── posts.json
└── settings.json
```

High-concurrency mode partitions data:

```
data/
├── users_p0.json
├── users_p1.json
├── users_p2.json
└── ...
```

Lazy loading mode uses index files for fast loading:

```
data/
├── users.json           # Full document data
├── users.index.json     # ID index for fast access
├── posts.json
└── posts.index.json
```

## 🧪 Examples

```bash
# Basic usage
npx tsx examples/basic-usage.ts

# Schema validation
npx tsx examples/schema-example.ts

# Benchmark
npx tsx examples/benchmark.ts
```

## 🔧 Development

```bash
# Install dependencies
yarn install

# Run tests
yarn test

# Build
yarn build

# Lint
yarn lint
```

## 📄 License

MIT © [Rashed Iqbal](https://github.com/iqbal-rashed)
