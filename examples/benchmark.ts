/**
 * High-Concurrency Benchmark
 *
 * This benchmark demonstrates the performance of the high-concurrency mode
 * compared to standard mode under heavy write and read loads.
 *
 * Run with: npx tsx examples/benchmark.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { JsonDB } from '../src';
import type { Document } from '../src/types';

interface BenchmarkDoc extends Document {
  _id: string;
  value: number;
  timestamp: number;
  data: string;
}

interface BenchmarkResult {
  mode: string;
  operation: string;
  count: number;
  durationMs: number;
  docsPerSecond: number;
  bytesProcessed: number;
  throughputMBps: number;
  memoryUsedMB: number;
}

// Approximate size of each document in bytes (for throughput calculation)
const DOC_SIZE_BYTES = 150; // ~150 bytes per doc (id + value + timestamp + 100 chars data)

async function runWriteBenchmark(
  mode: 'standard' | 'high-concurrency',
  operationCount: number
): Promise<BenchmarkResult> {
  const testDir = path.join(os.tmpdir(), `jsondb-bench-${mode}-${Date.now()}`);

  const db = new JsonDB({
    dataDir: testDir,
    prettyPrint: false,
    highConcurrency:
      mode === 'high-concurrency'
        ? {
            enabled: true,
            partitions: 16,
            batchSize: 1000,
            flushInterval: 50,
            maxConcurrentIO: 4,
          }
        : undefined,
  });

  await db.connect();
  const collection = db.collection<BenchmarkDoc>('benchmark');

  const docs = Array.from({ length: operationCount }, (_, i) => ({
    value: i,
    timestamp: Date.now(),
    data: `benchmark-data-${i}-${'x'.repeat(100)}`,
  }));

  const memBefore = process.memoryUsage().heapUsed;
  const startTime = performance.now();

  await collection.insertMany(docs);
  await db.flush();

  const endTime = performance.now();
  const durationMs = endTime - startTime;
  const memAfter = process.memoryUsage().heapUsed;
  const memoryUsedMB = (memAfter - memBefore) / (1024 * 1024);

  const count = await collection.count();
  if (count !== operationCount) {
    throw new Error(`Data integrity check failed: expected ${operationCount}, got ${count}`);
  }

  await db.close();
  await fs.promises.rm(testDir, { recursive: true, force: true });

  const bytesProcessed = operationCount * DOC_SIZE_BYTES;
  const durationSec = durationMs / 1000;
  const throughputMBps = bytesProcessed / (1024 * 1024) / durationSec;

  return {
    mode,
    operation: 'write',
    count: operationCount,
    durationMs,
    docsPerSecond: Math.round((operationCount / durationMs) * 1000),
    bytesProcessed,
    throughputMBps: Math.round(throughputMBps * 100) / 100,
    memoryUsedMB: Math.round(memoryUsedMB * 100) / 100,
  };
}

async function runReadBenchmark(
  mode: 'standard' | 'high-concurrency',
  documentCount: number
): Promise<BenchmarkResult> {
  const testDir = path.join(os.tmpdir(), `jsondb-bench-read-${mode}-${Date.now()}`);

  const db = new JsonDB({
    dataDir: testDir,
    prettyPrint: false,
    highConcurrency:
      mode === 'high-concurrency'
        ? {
            enabled: true,
            partitions: 16,
            batchSize: 1000,
            flushInterval: 50,
            maxConcurrentIO: 4,
          }
        : undefined,
  });

  await db.connect();
  const collection = db.collection<BenchmarkDoc>('benchmark');

  // Insert documents first
  const docs = Array.from({ length: documentCount }, (_, i) => ({
    value: i,
    timestamp: Date.now(),
    data: `benchmark-data-${i}-${'x'.repeat(100)}`,
  }));
  await collection.insertMany(docs);
  await db.flush();

  const memBefore = process.memoryUsage().heapUsed;
  const startTime = performance.now();

  // Run find operations
  const results = await collection.find({ value: { $gte: 0 } });

  const endTime = performance.now();
  const durationMs = endTime - startTime;
  const memAfter = process.memoryUsage().heapUsed;
  const memoryUsedMB = (memAfter - memBefore) / (1024 * 1024);

  if (results.length !== documentCount) {
    throw new Error(`Read check failed: expected ${documentCount}, got ${results.length}`);
  }

  await db.close();
  await fs.promises.rm(testDir, { recursive: true, force: true });

  const bytesProcessed = documentCount * DOC_SIZE_BYTES;
  const durationSec = durationMs / 1000;
  const throughputMBps = bytesProcessed / (1024 * 1024) / durationSec;

  return {
    mode,
    operation: 'read',
    count: documentCount,
    durationMs,
    docsPerSecond: Math.round((documentCount / durationMs) * 1000),
    bytesProcessed,
    throughputMBps: Math.round(throughputMBps * 100) / 100,
    memoryUsedMB: Math.round(memoryUsedMB * 100) / 100,
  };
}

function formatSpeed(result: BenchmarkResult): string {
  return `${result.docsPerSecond.toLocaleString()} docs/sec | ${result.throughputMBps} MB/s`;
}

function printComparison(standardResult: BenchmarkResult, hcResult: BenchmarkResult) {
  const improvement = Math.round(
    ((hcResult.docsPerSecond - standardResult.docsPerSecond) / standardResult.docsPerSecond) * 100
  );

  if (improvement > 0) {
    console.log(`  ✅ High-concurrency mode is ${improvement}% faster!`);
  } else if (improvement < 0) {
    console.log(`  ⚠️ Standard mode is ${Math.abs(improvement)}% faster`);
  } else {
    console.log('  📊 Both modes performed similarly');
  }
}

async function main() {
  console.log('\n🚀 JSON Database High-Concurrency Benchmark\n');
  console.log('═'.repeat(60));

  const operationCounts = [1000, 10000, 100000, 500000, 1000000];

  // Write Benchmark
  console.log('\n📝 WRITE BENCHMARK (insertMany)\n');
  console.log('─'.repeat(60));

  for (const count of operationCounts) {
    console.log(`\n📊 ${count.toLocaleString()} documents...\n`);

    let standardResult: BenchmarkResult | null = null;
    let hcResult: BenchmarkResult | null = null;

    try {
      console.log('  Standard mode...');
      standardResult = await runWriteBenchmark('standard', count);
      console.log(`  → ${formatSpeed(standardResult)}`);
    } catch (error) {
      console.error(`  ❌ Failed:`, (error as Error).message);
    }

    try {
      console.log('  High-concurrency mode...');
      hcResult = await runWriteBenchmark('high-concurrency', count);
      console.log(`  → ${formatSpeed(hcResult)}`);
    } catch (error) {
      console.error(`  ❌ Failed:`, (error as Error).message);
    }

    if (standardResult && hcResult) {
      printComparison(standardResult, hcResult);
    }
  }

  // Read Benchmark
  console.log('\n\n📖 READ BENCHMARK (find)\n');
  console.log('─'.repeat(60));

  for (const count of operationCounts) {
    console.log(`\n📊 ${count.toLocaleString()} documents...\n`);

    let standardResult: BenchmarkResult | null = null;
    let hcResult: BenchmarkResult | null = null;

    try {
      console.log('  Standard mode...');
      standardResult = await runReadBenchmark('standard', count);
      console.log(`  → ${formatSpeed(standardResult)}`);
    } catch (error) {
      console.error(`  ❌ Failed:`, (error as Error).message);
    }

    try {
      console.log('  High-concurrency mode...');
      hcResult = await runReadBenchmark('high-concurrency', count);
      console.log(`  → ${formatSpeed(hcResult)}`);
    } catch (error) {
      console.error(`  ❌ Failed:`, (error as Error).message);
    }

    if (standardResult && hcResult) {
      printComparison(standardResult, hcResult);
    }
  }

  console.log('\n\n✨ Benchmark complete!\n');
  console.log('Notes:');
  console.log('- Standard mode: single file per collection');
  console.log('- High-concurrency mode: partitioned files with write batching');
  console.log('- HC mode excels with many concurrent independent operations');
  console.log(`- Document size: ~${DOC_SIZE_BYTES} bytes each`);
  console.log('');
}

main().catch(console.error);
