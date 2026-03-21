export { AutomergeFs, normalizePath, joinPath, type StatInfo, type DirEntry } from "./fs"
export { type BlobStore, InMemoryBlobStore } from "./blob-store"
export {
  FileHandlerRegistry,
  type FileHandler,
  textFileHandler,
  type TextFileDoc,
  createBlobFileHandler,
  type BlobFileDoc,
  rawJsonFallbackHandler,
} from "./file-handlers"
