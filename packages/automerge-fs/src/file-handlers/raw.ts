/**
 * Raw JSON fallback file handler.
 *
 * Returned by the registry when no registered handler claims a doc at read time.
 * Serializes the entire Automerge doc as JSON bytes on read.
 */

import type { Repo, DocHandle } from "@automerge/automerge-repo"
import type { FileHandler } from "./"

export const rawHandler: FileHandler = {
  name: "raw-json",
  extensions: [],

  async createDoc(repo: Repo, content: Uint8Array): Promise<DocHandle<{ content: string }>> {
    const text = new TextDecoder().decode(content)
    const handle = repo.create<{ content: string }>()
    handle.change((doc: any) => {
      doc.content = text
    })
    return handle
  },

  async write(handle: DocHandle<unknown>, content: Uint8Array): Promise<void> {
    handle.change((doc: any) => {
      doc.content = new TextDecoder().decode(content)
    })
  },

  async read(handle: DocHandle<unknown>): Promise<Uint8Array> {
    const doc = handle.doc()
    return new TextEncoder().encode(JSON.stringify(doc ?? {}))
  },
}
