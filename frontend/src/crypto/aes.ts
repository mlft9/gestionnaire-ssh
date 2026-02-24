/**
 * Chiffrement AES-256-GCM via Web Crypto API (natif navigateur).
 *
 * - IV : 96 bits (12 octets) — aléatoire par opération
 * - Tag : 128 bits (inclus dans le ciphertext par WebCrypto)
 * - Données envoyées au serveur : { encrypted_cred: base64(ciphertext+tag), iv: base64(iv) }
 */

import { uint8ArrayToBase64, base64ToUint8Array } from './keys'

export interface EncryptedBlob {
  encryptedCred: string  // base64(ciphertext || GCM tag)
  iv: string             // base64(96-bit IV)
}

/**
 * Chiffre un credential (mot de passe ou clé privée) avec la MasterKey.
 */
export async function encryptCredential(
  masterKey: CryptoKey,
  credential: string
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 96 bits
  const encoded = new TextEncoder().encode(credential)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    masterKey,
    encoded
  )

  return {
    encryptedCred: uint8ArrayToBase64(new Uint8Array(ciphertext)),
    iv: uint8ArrayToBase64(iv),
  }
}

/**
 * Déchiffre un credential stocké sur le serveur.
 */
export async function decryptCredential(
  masterKey: CryptoKey,
  blob: EncryptedBlob
): Promise<string> {
  const iv = base64ToUint8Array(blob.iv)
  const ciphertext = base64ToUint8Array(blob.encryptedCred)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, tagLength: 128 },
    masterKey,
    ciphertext.buffer as ArrayBuffer
  )

  return new TextDecoder().decode(decrypted)
}
