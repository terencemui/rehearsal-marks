import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';

// jsdom's Blob lacks arrayBuffer(); use Node's standards-complete Blob so
// storage tests exercise real Blob semantics (hashing, IndexedDB round-trips).
globalThis.Blob = NodeBlob as unknown as typeof Blob;
