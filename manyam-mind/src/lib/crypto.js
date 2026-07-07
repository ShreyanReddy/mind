// End-to-end encryption — PLAN.md §1.3.
// Per-vault key derived from a passphrase (Argon2id via libsodium), used to
// encrypt anything before it leaves the device (sync.js). The server must
// never see plaintext vault content — only the salt is ever persisted
// (Dexie meta), never the passphrase or the derived key.

import _sodium from 'libsodium-wrappers-sumo'

let readyPromise = null

/** Resolves once libsodium's WASM is loaded. Safe to call repeatedly. */
export function sodiumReady() {
  if (!readyPromise) readyPromise = _sodium.ready.then(() => _sodium)
  return readyPromise
}

function requireSodium() {
  if (!_sodium.crypto_pwhash) throw new Error('sodium not ready — call sodiumReady() first')
  return _sodium
}

export function toBase64(bytes) {
  const sodium = requireSodium()
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL)
}

export function fromBase64(str) {
  const sodium = requireSodium()
  return sodium.from_base64(str, sodium.base64_variants.ORIGINAL)
}

/**
 * Derive a vault key from a passphrase using Argon2id.
 * Pass a previously-persisted base64 `salt` to re-derive the same key.
 * Returns { key: Uint8Array, salt: base64 string } — persist ONLY the salt.
 */
export async function deriveVaultKey(passphrase, salt) {
  const sodium = await sodiumReady()
  const saltBytes = salt ? fromBase64(salt) : sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)
  const key = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase,
    saltBytes,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  )
  return { key, salt: toBase64(saltBytes) }
}

/** Encrypt a string or byte array. Returns { nonce, cipher } as base64 strings. */
export async function encrypt(key, data) {
  const sodium = await sodiumReady()
  const bytes = typeof data === 'string' ? sodium.from_string(data) : data
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  const cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(bytes, null, null, nonce, key)
  return { nonce: toBase64(nonce), cipher: toBase64(cipher) }
}

/** Decrypt (nonce, cipher as base64 or bytes) back to a Uint8Array. Throws on tamper/wrong key. */
export async function decrypt(key, nonce, cipher) {
  const sodium = await sodiumReady()
  const nonceBytes = typeof nonce === 'string' ? fromBase64(nonce) : nonce
  const cipherBytes = typeof cipher === 'string' ? fromBase64(cipher) : cipher
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, cipherBytes, null, nonceBytes, key)
}

export async function decryptToString(key, nonce, cipher) {
  const sodium = await sodiumReady()
  const bytes = await decrypt(key, nonce, cipher)
  return sodium.to_string(bytes)
}

// ---- session key holder ----------------------------------------------
// The derived key lives in memory only, for the current session. It is
// never persisted (only its salt is, in Dexie meta under 'vaultSalt').
// Sync (sync.js) refuses to run without a derived key.
let sessionKey = null
export function setSessionKey(key) {
  sessionKey = key
}
export function getSessionKey() {
  return sessionKey
}
export function clearSessionKey() {
  sessionKey = null
}
