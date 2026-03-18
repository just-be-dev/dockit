import { describe, expect, it, mock, beforeEach } from "bun:test"
import { D1StorageAdapter } from "./index.ts"

// Minimal D1 mock that stores data in a Map
function createMockD1(): D1Database {
  const store = new Map<string, Uint8Array>()

  const mockStatement = (query: string) => {
    let boundValues: unknown[] = []

    const stmt: D1PreparedStatement = {
      bind(...values: unknown[]) {
        boundValues = values
        return stmt
      },
      async first<T>(): Promise<T | null> {
        const key = boundValues[0] as string
        const data = store.get(key)
        if (!data) return null
        return { data: data.buffer as ArrayBuffer } as T
      },
      async run() {
        if (query.startsWith("INSERT")) {
          const key = boundValues[0] as string
          const data = boundValues[1] as Uint8Array
          store.set(key, new Uint8Array(data))
        } else if (query.startsWith("DELETE") && query.includes("LIKE")) {
          const prefix = boundValues[0] as string
          for (const k of store.keys()) {
            if (k.startsWith(prefix)) store.delete(k)
          }
        } else if (query.startsWith("DELETE")) {
          store.delete(boundValues[0] as string)
        }
        return { results: [], success: true, meta: {} } as any
      },
      async all<T>() {
        const prefix = boundValues[0] as string
        const results: { key: string; data: ArrayBuffer }[] = []
        for (const [k, v] of store.entries()) {
          if (k.startsWith(prefix)) {
            results.push({ key: k, data: v.buffer as ArrayBuffer })
          }
        }
        return { results, success: true, meta: {} } as any
      },
      async raw() {
        return [] as any
      },
    }
    return stmt
  }

  return {
    prepare: (query: string) => mockStatement(query),
    exec: mock(async () => ({ count: 0, duration: 0 })),
    batch: mock(async () => []),
    dump: mock(async () => new ArrayBuffer(0)),
    withSession: mock(() => ({} as any)),
  } as unknown as D1Database
}

describe("D1StorageAdapter", () => {
  let db: D1Database
  let adapter: D1StorageAdapter

  beforeEach(() => {
    db = createMockD1()
    adapter = new D1StorageAdapter(db)
  })

  it("initializes the table on construction", async () => {
    // Force initialization to complete
    await adapter.load(["nonexistent"])
    expect(db.exec).toHaveBeenCalled()
  })

  it("returns undefined for missing keys", async () => {
    const result = await adapter.load(["abc123", "snapshot", "hash1"])
    expect(result).toBeUndefined()
  })

  it("saves and loads data", async () => {
    const key = ["abc123", "snapshot", "hash1"]
    const data = new Uint8Array([1, 2, 3, 4])
    await adapter.save(key, data)
    const loaded = await adapter.load(key)
    expect(loaded).toEqual(data)
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

    const snapshot = await adapter.load(["abc123", "snapshot", "h3"])
    expect(snapshot).toEqual(new Uint8Array([3]))
  })
})
