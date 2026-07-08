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

// ---- X25519 keypairs & sealed-box (PLAN.md §3.1/§3.2) -----------------
// Used by the marketplace, not the vault-sync path above: every profile
// publishes a public key (profiles.public_key); listing content keys are
// sealed to the buyer's public key with crypto_box_seal so only the buyer's
// locally-held private key (Dexie meta, never uploaded) can open them. The
// server only ever handles ciphertext/sealed boxes, never key material.

/** Generate a new X25519 keypair. Returns base64 { publicKey, privateKey }. */
export async function generateKeyPair() {
  const sodium = await sodiumReady()
  const pair = sodium.crypto_box_keypair()
  return { publicKey: toBase64(pair.publicKey), privateKey: toBase64(pair.privateKey) }
}

/** Anonymously seal `data` (string or bytes) to a recipient's base64 public key. Returns base64 ciphertext. */
export async function sealToPublicKey(publicKeyB64, data) {
  const sodium = await sodiumReady()
  const bytes = typeof data === 'string' ? sodium.from_string(data) : data
  const sealed = sodium.crypto_box_seal(bytes, fromBase64(publicKeyB64))
  return toBase64(sealed)
}

/** Open a sealed box with the recipient's own base64 keypair. Returns a Uint8Array. Throws on tamper/wrong key. */
export async function unsealWithKeyPair(publicKeyB64, privateKeyB64, sealedB64) {
  const sodium = await sodiumReady()
  const opened = sodium.crypto_box_seal_open(fromBase64(sealedB64), fromBase64(publicKeyB64), fromBase64(privateKeyB64))
  return opened
}

/** Convenience: unseal a sealed box that was a UTF-8 string (e.g. a base64-encoded content key) back to a string. */
export async function unsealToString(keyPair, sealedB64) {
  const sodium = await sodiumReady()
  const bytes = await unsealWithKeyPair(keyPair.publicKey, keyPair.privateKey, sealedB64)
  return sodium.to_string(bytes)
}

/** XChaCha20-Poly1305 nonce length in bytes — fixed by the algorithm, used to frame encrypted bundles (nonce || ciphertext) without a separate DB column. */
export const XCHACHA_NONCE_BYTES = 24

// ---- content-key generation & hashing (PLAN.md §3.2) -------------------

/** A fresh random 32-byte content key for encrypting one listing bundle, as base64 — compatible with encrypt()/decrypt() above (XChaCha20-Poly1305). */
export async function generateContentKey() {
  const sodium = await sodiumReady()
  return toBase64(sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES))
}

/** SHA-256 of bytes (or a plain string, UTF-8 encoded), hex-encoded. Uses WebCrypto only — no sodium dependency — so it hashes CIPHERTEXT bytes without needing the WASM module ready. Never hash plaintext vault content with this outside tests. */
export async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
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
