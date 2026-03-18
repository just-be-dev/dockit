import { describe, expect, it, beforeEach } from "bun:test"
import { DOStorageAdapter } from "./index.ts"

function createMockStorage(): DurableObjectStorage {
  const store = new Map<string, unknown>()

  return {
    async get(keyOrKeys: string | string[]) {
      if (Array.isArray(keyOrKeys)) {
        const map = new Map()
        for (const k of keyOrKeys) {
          const v = store.get(k)
          if (v !== undefined) map.set(k, v)
        }
        return map
      }
      return store.get(keyOrKeys)
    },
    async put(keyOrEntries: string | Record<string, unknown>, value?: unknown) {
      if (typeof keyOrEntries === "string") {
        store.set(keyOrEntries, value)
      } else {
        for (const [k, v] of Object.entries(keyOrEntries)) {
          store.set(k, v)
        }
      }
    },
    async delete(keyOrKeys: string | string[]) {
      if (Array.isArray(keyOrKeys)) {
        let count = 0
        for (const k of keyOrKeys) {
          if (store.delete(k)) count++
        }
        return count
      }
      return store.delete(keyOrKeys)
    },
    async list(options?: { prefix?: string }) {
      const map = new Map()
      for (const [k, v] of store) {
        if (!options?.prefix || k.startsWith(options.prefix)) {
          map.set(k, v)
        }
      }
      return map
    },
  } as unknown as DurableObjectStorage
}

describe("DOStorageAdapter", () => {
  let storage: DurableObjectStorage
  let adapter: DOStorageAdapter

  beforeEach(() => {
    storage = createMockStorage()
    adapter = new DOStorageAdapter(storage)
  })

  it("returns undefined for missing keys", async () => {
    expect(await adapter.load(["abc123", "snapshot", "h1"])).toBeUndefined()
  })

  it("saves and loads data", async () => {
    const key = ["abc123", "snapshot", "hash1"]
    const data = new Uint8Array([1, 2, 3, 4])
    await adapter.save(key, data)
    expect(await adapter.load(key)).toEqual(data)
  })

  it("removes data", async () => {
    const key = ["abc123", "snapshot", "hash1"]
    await adapter.save(key, new Uint8Array([1, 2, 3]))
    await adapter.remove(key)
    expect(await adapter.load(key)).toBeUndefined()
  })

  it("loads a range of keys by prefix", async () => {
    await adapter.save(["abc123", "incremental", "h1"], new Uint8Array([1]))
    await adapter.save(["abc123", "incremental", "h2"], new Uint8Array([2]))
    await adapter.save(["abc123", "snapshot", "h3"], new Uint8Array([3]))

    const chunks = await adapter.loadRange(["abc123", "incremental"])
    expect(chunks).toHaveLength(2)
    expect(chunks.map((c) => c.key)).toEqual(
      expect.arrayContaining([
        ["abc123", "incremental", "h1"],
        ["abc123", "incremental", "h2"],
      ])
    )
  })

  it("removes a range of keys by prefix", async () => {
    await adapter.save(["abc123", "incremental", "h1"], new Uint8Array([1]))
    await adapter.save(["abc123", "incremental", "h2"], new Uint8Array([2]))
    await adapter.save(["abc123", "snapshot", "h3"], new Uint8Array([3]))

    await adapter.removeRange(["abc123", "incremental"])

    const remaining = await adapter.loadRange(["abc123", "incremental"])
    expect(remaining).toHaveLength(0)

    expect(await adapter.load(["abc123", "snapshot", "h3"])).toEqual(
      new Uint8Array([3])
    )
  })
})
