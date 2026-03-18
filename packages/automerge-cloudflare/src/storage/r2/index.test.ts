import { describe, expect, it } from "bun:test"
import { R2StorageAdapter } from "./index.ts"

// Unit tests for key mapping logic. These don't require an R2 connection.
describe("R2StorageAdapter key mapping", () => {
  // Create adapter with a mock R2Bucket (methods unused by these tests)
  const adapter = new R2StorageAdapter({} as R2Bucket)

  // Access private methods via cast
  const a = adapter as unknown as {
    toObjectKey(key: string[]): string
    fromObjectKey(key: string): string[]
  }

  it("converts a storage key to an object key with shard prefix", () => {
    expect(a.toObjectKey(["abc123", "snapshot", "hash1"])).toBe(
      "ab/c123/snapshot/hash1"
    )
  })

  it("converts a single-element key", () => {
    expect(a.toObjectKey(["abc123"])).toBe("ab/c123")
  })

  it("round-trips a key through toObjectKey and fromObjectKey", () => {
    const key = ["abc123def", "incremental", "somehash"]
    const objectKey = a.toObjectKey(key)
    expect(a.fromObjectKey(objectKey)).toEqual(key)
  })

  it("applies prefix when configured", () => {
    const prefixed = new R2StorageAdapter({} as R2Bucket, {
      prefix: "automerge/",
    }) as unknown as typeof a

    expect(prefixed.toObjectKey(["abc123", "snapshot", "h"])).toBe(
      "automerge/ab/c123/snapshot/h"
    )
    expect(
      prefixed.fromObjectKey("automerge/ab/c123/snapshot/h")
    ).toEqual(["abc123", "snapshot", "h"])
  })
})
