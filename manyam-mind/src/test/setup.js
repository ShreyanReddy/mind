// Vitest setup — runs once per test file. Wires jest-dom's matchers
// (toBeInTheDocument, etc.) into Vitest's `expect`, and polyfills IndexedDB
// (jsdom doesn't implement it) so store.js's Dexie-backed persistence works
// under test.
import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
