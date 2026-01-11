/**
 * LRU (Least Recently Used) Cache implementation
 * Automatically evicts least recently used items when capacity is exceeded
 */
export class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly cache: Map<K, V>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  /**
   * Get a value from the cache
   * Moves the item to the end (most recently used)
   */
  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }

    // Move to end (most recently used)
    const value = this.cache.get(key);
    if (value === undefined) return undefined;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Set a value in the cache
   * Evicts least recently used item if at capacity
   */
  set(key: K, value: V): void {
    // If key exists, delete it first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  /**
   * Check if key exists in cache
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a key from cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all items from cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get all keys in cache
   */
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  /**
   * Get all values in cache
   */
  values(): IterableIterator<V> {
    return this.cache.values();
  }

  /**
   * Iterate over entries
   */
  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  /**
   * ForEach over entries
   */
  forEach(callback: (value: V, key: K) => void): void {
    this.cache.forEach(callback);
  }
}
