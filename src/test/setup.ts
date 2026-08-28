import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { installResizeObserverStub } from './resize-observer';

// jsdom's Blob and File lack arrayBuffer(); use Node's standards-complete
// implementations so storage tests exercise real Blob/File semantics (hashing,
// IndexedDB round-trips, uploads).
globalThis.Blob = NodeBlob as unknown as typeof Blob;
globalThis.File = NodeFile as unknown as typeof File;

// jsdom implements no ResizeObserver; install the test seam the player's
// markers-height measurement runs on.
installResizeObserverStub();
