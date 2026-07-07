// libsodium-wrappers-sumo's wasm glue does a strict `instanceof Uint8Array`
// check; under jsdom, jsdom's own global Uint8Array is a different realm
// object than Node's, so every call fails with "unsupported input type for
// message" even though the value is a real Uint8Array. This file needs no
// DOM, so it runs in the plain node environment instead.
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { sodiumReady, deriveVaultKey, encrypt, decrypt, decryptToString } from '../crypto.js'

beforeAll(async () => {
  await sodiumReady()
}, 20000)

describe('crypto', () => {
  it('round-trips a string through encrypt/decrypt', async () => {
    const { key } = await deriveVaultKey('correct horse battery staple')
    const { nonce, cipher } = await encrypt(key, 'hello vault')
    const plain = await decryptToString(key, nonce, cipher)
    expect(plain).toBe('hello vault')
  })

  it('throws when decrypting with the wrong key', async () => {
    const { key: keyA } = await deriveVaultKey('passphrase-a')
    const { key: keyB } = await deriveVaultKey('passphrase-b')
    const { nonce, cipher } = await encrypt(keyA, 'secret')
    await expect(decrypt(keyB, nonce, cipher)).rejects.toThrow()
  })

  it('uses a distinct nonce for every encryption, even of the same message', async () => {
    const { key } = await deriveVaultKey('same passphrase')
    const a = await encrypt(key, 'message one')
    const b = await encrypt(key, 'message one')
    expect(a.nonce).not.toBe(b.nonce)
  })

  it('re-derives the same key from a persisted salt', async () => {
    const first = await deriveVaultKey('my passphrase')
    const second = await deriveVaultKey('my passphrase', first.salt)
    expect(second.salt).toBe(first.salt)

    const { nonce, cipher } = await encrypt(first.key, 'consistent key check')
    const plain = await decryptToString(second.key, nonce, cipher)
    expect(plain).toBe('consistent key check')
  })
}, 20000)
