import { describe, expect, it, beforeEach, mock } from "bun:test"
import {
  cbor,
  type DocumentId,
  type PeerId,
  type PeerMetadata,
} from "@automerge/automerge-repo"
import { DONetworkAdapter } from "./index.ts"

/** Convert a Buffer/Uint8Array to a properly-sized ArrayBuffer */
function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  ) as ArrayBuffer
}

function createMockWebSocket(): WebSocket {
  let attachment: unknown = null
  return {
    send: mock(() => {}),
    close: mock(() => {}),
    readyState: 1,
    serializeAttachment(value: unknown) {
      attachment = structuredClone(value)
    },
    deserializeAttachment() {
      return attachment
    },
  } as unknown as WebSocket
}

function createMockCtx(
  websockets: WebSocket[] = []
): DurableObjectState {
  return {
    getWebSockets: () => websockets,
  } as unknown as DurableObjectState
}

function encodeMsg(msg: unknown): ArrayBuffer {
  return toArrayBuffer(cbor.encode(msg))
}

describe("DONetworkAdapter", () => {
  let adapter: DONetworkAdapter
  const serverPeerId = "server-peer" as PeerId
  const serverMeta: PeerMetadata = { isEphemeral: false }

  beforeEach(() => {
    adapter = new DONetworkAdapter(createMockCtx())
    adapter.connect(serverPeerId, serverMeta)
  })

  it("is immediately ready", () => {
    expect(adapter.isReady()).toBe(true)
  })

  it("handles a join message and emits peer-candidate", () => {
    const ws = createMockWebSocket()
    const peerCandidate = mock(() => {})
    adapter.on("peer-candidate", peerCandidate)

    adapter.receiveMessage(
      ws,
      encodeMsg({
        type: "join",
        senderId: "client-1" as PeerId,
        peerMetadata: { isEphemeral: true },
      })
    )

    expect(peerCandidate).toHaveBeenCalledTimes(1)
    expect(peerCandidate).toHaveBeenCalledWith({
      peerId: "client-1",
      peerMetadata: { isEphemeral: true },
    })

    // Should have sent a "peer" response
    expect(ws.send).toHaveBeenCalledTimes(1)
  })

  it("persists peer ID via serializeAttachment on join", () => {
    const ws = createMockWebSocket()

    adapter.receiveMessage(
      ws,
      encodeMsg({
        type: "join",
        senderId: "client-1" as PeerId,
        peerMetadata: { isEphemeral: true },
      })
    )

    const attachment = ws.deserializeAttachment()
    expect(attachment).toEqual({
      peerId: "client-1",
      peerMetadata: { isEphemeral: true },
    })
  })

  it("routes messages to the correct peer socket", () => {
    const ws = createMockWebSocket()

    adapter.receiveMessage(
      ws,
      encodeMsg({
        type: "join",
        senderId: "client-1" as PeerId,
        peerMetadata: { isEphemeral: true },
      })
    )

    adapter.send({
      type: "sync",
      senderId: serverPeerId,
      targetId: "client-1" as PeerId,
      data: new Uint8Array([1, 2, 3]),
      documentId: "doc1" as DocumentId,
    })

    // join response + sync message
    expect(ws.send).toHaveBeenCalledTimes(2)
  })

  it("emits message events for non-join messages", () => {
    const ws = createMockWebSocket()
    const messageHandler = mock(() => {})
    adapter.on("message", messageHandler)

    adapter.receiveMessage(
      ws,
      encodeMsg({
        type: "join",
        senderId: "client-1" as PeerId,
        peerMetadata: { isEphemeral: true },
      })
    )

    adapter.receiveMessage(
      ws,
      encodeMsg({
        type: "sync",
        senderId: "client-1" as PeerId,
        targetId: serverPeerId,
        data: new Uint8Array([1, 2, 3]),
        documentId: "doc1" as DocumentId,
      })
    )

    expect(messageHandler).toHaveBeenCalledTimes(1)
  })

  it("emits peer-disconnected on handleClose", () => {
    const ws = createMockWebSocket()
    const disconnected = mock(() => {})
    adapter.on("peer-disconnected", disconnected)

    adapter.receiveMessage(
      ws,
      encodeMsg({
        type: "join",
        senderId: "client-1" as PeerId,
        peerMetadata: { isEphemeral: true },
      })
    )

    adapter.handleClose(ws)

    expect(disconnected).toHaveBeenCalledWith({ peerId: "client-1" })
  })

  it("handles reconnection from the same peer", () => {
    const ws1 = createMockWebSocket()
    const ws2 = createMockWebSocket()
    const disconnected = mock(() => {})
    adapter.on("peer-disconnected", disconnected)

    const joinMsg = encodeMsg({
      type: "join",
      senderId: "client-1" as PeerId,
      peerMetadata: { isEphemeral: true },
    })

    adapter.receiveMessage(ws1, joinMsg)
    adapter.receiveMessage(ws2, joinMsg)

    // Old connection should be disconnected
    expect(disconnected).toHaveBeenCalledTimes(1)

    adapter.send({
      type: "sync",
      senderId: serverPeerId,
      targetId: "client-1" as PeerId,
      data: new Uint8Array([1]),
      documentId: "doc1" as DocumentId,
    })

    // ws2 gets join response + sync
    expect(ws2.send).toHaveBeenCalledTimes(2)
    // ws1 only got join response
    expect(ws1.send).toHaveBeenCalledTimes(1)
  })

  it("ignores string messages", () => {
    const ws = createMockWebSocket()
    adapter.receiveMessage(ws, "hello")
    expect(ws.close).not.toHaveBeenCalled()
  })

  it("closes socket on invalid cbor", () => {
    const ws = createMockWebSocket()
    adapter.receiveMessage(ws, new ArrayBuffer(3))
    expect(ws.close).toHaveBeenCalled()
  })
})

describe("DONetworkAdapter hibernation", () => {
  const serverPeerId = "server-peer" as PeerId
  const serverMeta: PeerMetadata = { isEphemeral: false }

  it("restores peer mappings from hibernated websockets on connect", () => {
    // Simulate two WebSockets that survived hibernation with attachments
    const ws1 = createMockWebSocket()
    ws1.serializeAttachment({
      peerId: "client-1" as PeerId,
      peerMetadata: { isEphemeral: true },
    })

    const ws2 = createMockWebSocket()
    ws2.serializeAttachment({
      peerId: "client-2" as PeerId,
      peerMetadata: { isEphemeral: false },
    })

    const ctx = createMockCtx([ws1, ws2])
    const adapter = new DONetworkAdapter(ctx)

    const peerCandidate = mock(() => {})
    adapter.on("peer-candidate", peerCandidate)

    // connect() triggers restore
    adapter.connect(serverPeerId, serverMeta)

    // Should re-announce both peers
    expect(peerCandidate).toHaveBeenCalledTimes(2)

    // Should be able to send to restored peers
    adapter.send({
      type: "sync",
      senderId: serverPeerId,
      targetId: "client-1" as PeerId,
      data: new Uint8Array([1]),
      documentId: "doc1" as DocumentId,
    })
    expect(ws1.send).toHaveBeenCalledTimes(1)

    adapter.send({
      type: "sync",
      senderId: serverPeerId,
      targetId: "client-2" as PeerId,
      data: new Uint8Array([2]),
      documentId: "doc1" as DocumentId,
    })
    expect(ws2.send).toHaveBeenCalledTimes(1)
  })

  it("skips websockets without attachments", () => {
    const ws = createMockWebSocket()
    // No attachment set — simulates a socket that connected but never joined

    const ctx = createMockCtx([ws])
    const adapter = new DONetworkAdapter(ctx)

    const peerCandidate = mock(() => {})
    adapter.on("peer-candidate", peerCandidate)

    adapter.connect(serverPeerId, serverMeta)

    expect(peerCandidate).not.toHaveBeenCalled()
  })
})
