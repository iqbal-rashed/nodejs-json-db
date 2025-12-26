/**
 * Advanced Queries Example
 *
 * This example demonstrates advanced querying capabilities:
 * - Comparison operators ($gt, $lt, $gte, $lte, $ne)
 * - Array operators ($in, $nin, $contains)
 * - String operators ($regex, $startsWith, $endsWith)
 * - Logical operators ($and, $or, $not)
 * - Sorting and pagination
 *
 * Run with: npx tsx examples/advanced-queries.ts
 */

import { JsonDB, Document } from '../src';
import * as path from 'path';

interface Product extends Document {
  _id: string;
  name: string;
  category: string;
  price: number;
  inStock: boolean;
  tags: string[];
  rating: number;
}

async function main() {
  const db = new JsonDB({
    dataDir: path.join(__dirname, './data'),
  });

  await db.connect();

  const products = db.collection<Product>('products');
  await products.clear();

  // Insert sample products
  await products.insertMany([
    { name: 'Laptop Pro', category: 'electronics', price: 1299, inStock: true, tags: ['computer', 'portable'], rating: 4.5 },
    { name: 'Wireless Mouse', category: 'electronics', price: 49, inStock: true, tags: ['computer', 'accessory'], rating: 4.2 },
    { name: 'USB-C Cable', category: 'electronics', price: 15, inStock: true, tags: ['accessory', 'cable'], rating: 3.8 },
    { name: 'Standing Desk', category: 'furniture', price: 599, inStock: false, tags: ['office', 'ergonomic'], rating: 4.7 },
    { name: 'Office Chair', category: 'furniture', price: 299, inStock: true, tags: ['office', 'ergonomic'], rating: 4.1 },
    { name: 'Notebook', category: 'stationery', price: 5, inStock: true, tags: ['writing', 'office'], rating: 4.0 },
    { name: 'Mechanical Keyboard', category: 'electronics', price: 149, inStock: false, tags: ['computer', 'gaming'], rating: 4.8 },
    { name: 'Monitor 4K', category: 'electronics', price: 449, inStock: true, tags: ['computer', 'display'], rating: 4.6 },
  ]);

  console.log('--- Comparison Operators ---\n');

  // $gt (greater than)
  const expensive = await products.find({ price: { $gt: 200 } });
  console.log('Products > $200:', expensive.map((p) => `${p.name} ($${p.price})`));

  // $lte (less than or equal)
  const cheap = await products.find({ price: { $lte: 50 } });
  console.log('Products <= $50:', cheap.map((p) => p.name));

  // $ne (not equal)
  const notElectronics = await products.find({ category: { $ne: 'electronics' } });
  console.log('Non-electronics:', notElectronics.map((p) => p.name));

  // Range query
  const midRange = await products.find({ price: { $gte: 100, $lte: 500 } });
  console.log('$100-$500 range:', midRange.map((p) => p.name));

  console.log('\n--- Array Operators ---\n');

  // $in (value is in array)
  const specificCategories = await products.find({
    category: { $in: ['electronics', 'furniture'] },
  });
  console.log('Electronics or Furniture:', specificCategories.map((p) => p.name));

  // $nin (value not in array)
  const notThese = await products.find({
    category: { $nin: ['stationery'] },
  });
  console.log('Not stationery:', notThese.map((p) => p.name));

  // $contains (array contains value)
  const computerItems = await products.find({
    tags: { $contains: 'computer' },
  });
  console.log('Computer-related:', computerItems.map((p) => p.name));

  console.log('\n--- String Operators ---\n');

  // $regex
  const keyboardOrMouse = await products.find({
    name: { $regex: /keyboard|mouse/i },
  });
  console.log('Keyboard or Mouse products:', keyboardOrMouse.map((p) => p.name));

  // $startsWith
  const startsWithM = await products.find({
    name: { $startsWith: 'M' },
  });
  console.log('Names starting with M:', startsWithM.map((p) => p.name));

  // $endsWith
  const endsWithK = await products.find({
    name: { $endsWith: 'k' },
  });
  console.log('Names ending with k:', endsWithK.map((p) => p.name));

  console.log('\n--- Logical Operators ---\n');

  // $and (explicit)
  const inStockAndExpensive = await products.find({
    $and: [{ inStock: true }, { price: { $gt: 100 } }],
  });
  console.log('In stock AND > $100:', inStockAndExpensive.map((p) => p.name));

  // $or
  const cheapOrOutOfStock = await products.find({
    $or: [{ price: { $lt: 20 } }, { inStock: false }],
  });
  console.log('Cheap OR out of stock:', cheapOrOutOfStock.map((p) => p.name));

  // $not
  const notInStock = await products.find({
    $not: { inStock: true },
  });
  console.log('Not in stock:', notInStock.map((p) => p.name));

  console.log('\n--- Sorting & Pagination ---\n');

  // Sort by price ascending
  const byPriceAsc = await products.find({}, { sort: { price: 1 } });
  console.log('Sorted by price (asc):', byPriceAsc.map((p) => `${p.name}: $${p.price}`));

  // Sort by rating descending
  const byRatingDesc = await products.find({}, { sort: { rating: -1 } });
  console.log('Sorted by rating (desc):', byRatingDesc.map((p) => `${p.name}: ${p.rating}⭐`));

  // Pagination: skip 2, limit 3
  const page = await products.find({}, { skip: 2, limit: 3 });
  console.log('Page (skip 2, limit 3):', page.map((p) => p.name));

  // Combined: filter, sort, and paginate
  const topRatedElectronics = await products.find(
    { category: 'electronics', inStock: true },
    { sort: { rating: -1 }, limit: 3 }
  );
  console.log('Top 3 in-stock electronics:', topRatedElectronics.map((p) => `${p.name} (${p.rating}⭐)`));

  console.log('\n--- Exists Operator ---\n');

  // $exists - check if field has value
  const withRating = await products.find({ rating: { $exists: true } });
  console.log('Products with rating:', withRating.length);

  await db.close();
  console.log('\nDone!');
}

main().catch(console.error);
