/**
 * DEMO: How to properly export collections from modules
 *
 * This demonstrates the fix for the error:
 * "Property 'X' of exported anonymous class type may not be private or protected"
 */

import { JsonDB, Document, AnyCollection } from '../src';

// Define your document interface
interface ActiveDownload extends Document {
  url: string;
  progress: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
}

// Initialize database
const db = new JsonDB({
  dataDir: './.tmp/export-demo',
  autoSave: true,
});

// ============================================================
// SOLUTION 1: Explicit type annotation (RECOMMENDED)
// ============================================================
export const activeDownload = db.collection<ActiveDownload>('active-download');

// ============================================================
// SOLUTION 2: Use a class with getter
// ============================================================
class Collections {
  constructor(private db: JsonDB) {}

  get downloads(): AnyCollection<ActiveDownload> {
    return this.db.collection<ActiveDownload>('active-download');
  }
}

export const collections = new Collections(db);

// ============================================================
// SOLUTION 3: Factory function
// ============================================================
export function getDownloadsCollection(): AnyCollection<ActiveDownload> {
  return db.collection<ActiveDownload>('active-download');
}

// ============================================================
// DEMONSTRATION: The problem with implicit typing
// ============================================================
// ❌ WRONG - This causes the error:
// export const badDownload = db.collection<ActiveDownload>('bad');
//
// TypeScript error: Property 'applyUpdate' of exported anonymous class type
// may not be private or protected.
//
// The reason: TypeScript infers the exact union type from collection()
// which includes private/protected properties from the Collection classes.
//
// ✅ CORRECT - Always add explicit type annotation:
// export const goodDownload: AnyCollection<ActiveDownload> =
//   db.collection<ActiveDownload>('good');

// ============================================================
// Usage example
// ============================================================
async function demonstrate() {
  await db.connect();

  // Using the exported collection
  await activeDownload.insert({
    url: 'https://example.com/file.zip',
    progress: 0,
    status: 'pending',
  });

  const pending = await activeDownload.find({ status: 'pending' });
  console.log('Pending downloads:', pending.length);

  await db.close();
}

// Uncomment to run:
demonstrate().catch(console.error);
