/**
 * A {@link StorageAdapterInterface} implementation that stores data in
 * Cloudflare Durable Object storage.
 */

import type {
  Chunk,
  StorageAdapterInterface,
  StorageKey,
} from "@automerge/automerge-repo"

export class DOStorageAdapter implements StorageAdapterInterface {
  private storage: DurableObjectStorage

  constructor(storage: DurableObjectStorage) {
    this.storage = storage
  }

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    return this.storage.get<Uint8Array>(joinKey(key))
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    await this.storage.put(joinKey(key), data)
  }

  async remove(key: StorageKey): Promise<void> {
    await this.storage.delete(joinKey(key))
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    const prefix = joinKey(keyPrefix) + "/"
    const entries = await this.storage.list<Uint8Array>({ prefix })

    const chunks: Chunk[] = []
    for (const [k, data] of entries) {
      chunks.push({ key: splitKey(k), data })
    }
    return chunks
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    const prefix = joinKey(keyPrefix) + "/"
    const entries = await this.storage.list({ prefix })
    const keys = [...entries.keys()]

    // DO storage delete accepts up to 128 keys per call
    for (let i = 0; i < keys.length; i += 128) {
      await this.storage.delete(keys.slice(i, i + 128))
    }
  }
}

/**
 * Join a StorageKey into a flat string key using `/` as separator.
 * The first element is split into a 2-char shard prefix, matching
 * the R2 and D1 adapters' layout.
 *
 * Example: `["abc123", "snapshot", "hash"]` → `"ab/c123/snapshot/hash"`
 */
function joinKey(key: StorageKey): string {
  const [first, ...rest] = key
  return [first!.slice(0, 2), first!.slice(2), ...rest].join("/")
}

/**
 * Split a flat string key back into a StorageKey.
 */
function splitKey(keyStr: string): StorageKey {
  const [shard, firstRest, ...rest] = keyStr.split("/")
  return [shard! + firstRest!, ...rest]
}
