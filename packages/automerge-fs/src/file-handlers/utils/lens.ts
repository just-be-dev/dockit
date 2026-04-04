/**
 * Lens-based version migration for file handler documents.
 *
 * Each Automerge document stores a `_type` discriminator (e.g. "text.v1") that
 * identifies which handler and version created it. Lenses define bidirectional
 * transforms between versions, enabling transparent reads of older (or newer)
 * documents through BFS-discovered migration paths.
 */

// =============================================================================
// Types
// =============================================================================

/** Base shape for all handler-managed Automerge documents. */
export interface TypedDoc {
  _type: string
}

/** Bidirectional transform between two versions of a file handler's doc. */
export interface FileHandlerLens {
  readonly from: string // full type specifier, e.g. "text.v1"
  readonly to: string // full type specifier, e.g. "text.v2"
  readonly forward: (doc: any) => any
  readonly backward: (doc: any) => any
}

// =============================================================================
// Tag Helpers
// =============================================================================

export function parseDocType(tag: string): { type: string; version: string } {
  const dot = tag.lastIndexOf(".")
  if (dot <= 0) throw new Error(`Invalid _type tag: "${tag}"`)
  return { type: tag.slice(0, dot), version: tag.slice(dot + 1) }
}

export function formatDocType(type: string, version: string): string {
  return `${type}.${version}`
}

// =============================================================================
// Lens Application
// =============================================================================

/**
 * Apply lenses to transform a doc from its stored version to a target version.
 * Returns a transformed view — does NOT mutate the input doc.
 * Returns null if versions already match, no lenses are provided, or no path exists.
 */
export function applyLenses(
  doc: unknown,
  targetTag: string,
  lenses: readonly FileHandlerLens[],
): unknown | null {
  const typed = doc as TypedDoc | null | undefined
  if (!typed?._type) return null
  if (typed._type === targetTag) return null
  if (!lenses.length) return null

  const path = findLensPath(typed._type, targetTag, lenses)
  if (!path.length) return null

  let result = Object.assign({}, doc) as any
  for (const step of path) {
    result = step.transform(result)
  }
  return result
}

// =============================================================================
// Internal
// =============================================================================

interface LensStep {
  transform: (doc: any) => any
}

function findLensPath(
  from: string,
  to: string,
  lenses: readonly FileHandlerLens[],
): LensStep[] {
  // Build adjacency list
  const adj = new Map<string, Array<{ target: string; transform: (doc: any) => any }>>()

  for (const lens of lenses) {
    if (!adj.has(lens.from)) adj.set(lens.from, [])
    adj.get(lens.from)!.push({ target: lens.to, transform: lens.forward })

    if (!adj.has(lens.to)) adj.set(lens.to, [])
    adj.get(lens.to)!.push({ target: lens.from, transform: lens.backward })
  }

  // BFS
  const visited = new Set<string>([from])
  const queue: Array<{ node: string; path: LensStep[] }> = [{ node: from, path: [] }]

  while (queue.length > 0) {
    const { node, path } = queue.shift()!
    const neighbors = adj.get(node)
    if (!neighbors) continue

    for (const { target, transform } of neighbors) {
      if (target === to) return [...path, { transform }]
      if (!visited.has(target)) {
        visited.add(target)
        queue.push({ node: target, path: [...path, { transform }] })
      }
    }
  }

  return []
}
