/**
 * A {@link StorageAdapterInterface} implementation that stores data in
 * Cloudflare D1 using the Workers D1 database binding.
 */

import type {
  Chunk,
  StorageAdapterInterface,
  StorageKey,
} from "@automerge/automerge-repo"

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS automerge_storage (
    key TEXT PRIMARY KEY,
    data BLOB NOT NULL
  )
`

export class D1StorageAdapter implements StorageAdapterInterface {
  private db: D1Database
  private initialized: Promise<void>

  constructor(db: D1Database) {
    this.db = db
    this.initialized = this.init()
  }

  private async init(): Promise<void> {
    await this.db.exec(CREATE_TABLE)
  }

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    await this.initialized
    const keyStr = joinKey(key)
    const row = await this.db
      .prepare("SELECT data FROM automerge_storage WHERE key = ?")
      .bind(keyStr)
      .first<{ data: ArrayBuffer }>()
    if (row === null) return undefined
    return new Uint8Array(row.data)
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    await this.initialized
    const keyStr = joinKey(key)
    await this.db
      .prepare(
        "INSERT INTO automerge_storage (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data"
      )
      .bind(keyStr, data)
      .run()
  }

  async remove(key: StorageKey): Promise<void> {
    await this.initialized
    const keyStr = joinKey(key)
    await this.db
      .prepare("DELETE FROM automerge_storage WHERE key = ?")
      .bind(keyStr)
      .run()
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    await this.initialized
    const prefix = joinKey(keyPrefix) + "/"
    const result = await this.db
      .prepare(
        "SELECT key, data FROM automerge_storage WHERE key LIKE ? || '%'"
      )
      .bind(prefix)
      .all<{ key: string; data: ArrayBuffer }>()

    return result.results.map((row) => ({
      key: splitKey(row.key),
      data: new Uint8Array(row.data),
    }))
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    await this.initialized
    const prefix = joinKey(keyPrefix) + "/"
    await this.db
      .prepare("DELETE FROM automerge_storage WHERE key LIKE ? || '%'")
      .bind(prefix)
      .run()
  }
}

/**
 * Join a StorageKey into a flat string key using `/` as separator.
 * The first element is split into a 2-char shard prefix, matching
 * the R2 adapter's layout.
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
