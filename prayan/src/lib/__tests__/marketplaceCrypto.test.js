// Same jsdom/libsodium incompatibility noted in crypto.test.js — these
// exercise the marketplace's key-sealing and hashing primitives, all of
// which go through libsodium-wrappers-sumo.
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import {
  sodiumReady,
  generateKeyPair,
  sealToPublicKey,
  unsealWithKeyPair,
  unsealToString,
  generateContentKey,
  sha256Hex,
  encrypt,
  decrypt,
  fromBase64,
  XCHACHA_NONCE_BYTES,
} from '../crypto.js'

beforeAll(async () => {
  await sodiumReady()
}, 20000)

describe('X25519 sealed-box key wrapping (PLAN.md §3.2 — deliver-key)', () => {
  it('seals a content key to a recipient public key and the recipient unseals it with their private key', async () => {
    const buyer = await generateKeyPair()
    const contentKey = await generateContentKey()

    const wrapped = await sealToPublicKey(buyer.publicKey, contentKey)
    const opened = await unsealToString(buyer, wrapped)

    expect(opened).toBe(contentKey)
  })

  it('cannot be opened by a different keypair', async () => {
    const buyer = await generateKeyPair()
    const impostor = await generateKeyPair()
    const contentKey = await generateContentKey()

    const wrapped = await sealToPublicKey(buyer.publicKey, contentKey)
    await expect(unsealWithKeyPair(impostor.publicKey, impostor.privateKey, wrapped)).rejects.toThrow()
  })

  it('produces different ciphertext for the same key sealed twice (fresh ephemeral key each time)', async () => {
    const buyer = await generateKeyPair()
    const contentKey = await generateContentKey()
    const a = await sealToPublicKey(buyer.publicKey, contentKey)
    const b = await sealToPublicKey(buyer.publicKey, contentKey)
    expect(a).not.toBe(b)
  })
})

describe('generateContentKey', () => {
  it('generates a fresh 32-byte key each call, usable directly with encrypt/decrypt', async () => {
    const a = await generateContentKey()
    const b = await generateContentKey()
    expect(a).not.toBe(b)
    expect(fromBase64(a).length).toBe(32)

    const { nonce, cipher } = await encrypt(fromBase64(a), 'a listed mind, encrypted')
    const plain = await decrypt(fromBase64(a), nonce, cipher)
    expect(new TextDecoder().decode(plain)).toBe('a listed mind, encrypted')
  })
})

describe('sha256Hex (bundle integrity check, PLAN.md §3.5)', () => {
  it('is deterministic for the same bytes', async () => {
    const bytes = new TextEncoder().encode('ciphertext-bytes')
    const a = await sha256Hex(bytes)
    const b = await sha256Hex(bytes)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when even one byte changes — catches a tampered/corrupted download', async () => {
    const original = new TextEncoder().encode('ciphertext-bytes')
    const tampered = new Uint8Array(original)
    tampered[0] ^= 0xff
    expect(await sha256Hex(tampered)).not.toBe(await sha256Hex(original))
  })
})

describe('nonce-framed bundle encoding (marketplace.js listMindForSale / importPurchasedBundle)', () => {
  it('XCHACHA_NONCE_BYTES matches the actual nonce length encrypt() produces', async () => {
    const key = fromBase64(await generateContentKey())
    const { nonce } = await encrypt(key, 'x')
    expect(fromBase64(nonce).length).toBe(XCHACHA_NONCE_BYTES)
  })

  it('round-trips a full frame: nonce || ciphertext -> split -> decrypt', async () => {
    const keyB64 = await generateContentKey()
    const key = fromBase64(keyB64)
    const plaintext = new TextEncoder().encode(JSON.stringify({ hello: 'mind' }))
    const { nonce, cipher } = await encrypt(key, plaintext)

    const nonceBytes = fromBase64(nonce)
    const cipherBytes = fromBase64(cipher)
    const framed = new Uint8Array(nonceBytes.length + cipherBytes.length)
    framed.set(nonceBytes, 0)
    framed.set(cipherBytes, nonceBytes.length)

    const splitNonce = framed.slice(0, XCHACHA_NONCE_BYTES)
    const splitCipher = framed.slice(XCHACHA_NONCE_BYTES)
    const decrypted = await decrypt(key, splitNonce, splitCipher)
    expect(JSON.parse(new TextDecoder().decode(decrypted))).toEqual({ hello: 'mind' })
  })
})
