/**
 * Example showing the correct way to export typed collections
 */

import { JsonDB, Document, AnyCollection } from '../src';

interface ActiveDownload extends Document {
  url: string;
  progress: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
}

// Initialize database
const jsondb = new JsonDB({
  dataDir: './.tmp/test-data',
  autoSave: true,
});

/**
 * ✅ CORRECT: Explicit type annotation using AnyCollection<T>
 *
 * This prevents TypeScript from complaining about private/protected properties
 * in the exported class type.
 */
export const activeDownload: AnyCollection<ActiveDownload> =
  jsondb.collection<ActiveDownload>('active-download');

/**
 * ✅ ALSO CORRECT: You can use a getter in a class
 */

/**
 * ✅ ALSO CORRECT: Export a function that returns the collection
 */
export function getActiveDownloads(db: JsonDB): AnyCollection<ActiveDownload> {
  return db.collection<ActiveDownload>('active-download');
}

// Example usage
async function main() {
  await jsondb.connect();

  // Insert a download
  await activeDownload.insert({
    url: 'https://example.com/file.zip',
    progress: 0,
    status: 'pending',
  });

  // Find downloads
  const pending = await activeDownload.find({ status: 'pending' });
  console.log('Pending downloads:', pending);

  await jsondb.close();
}

// Uncomment to run:
main().catch(console.error);
