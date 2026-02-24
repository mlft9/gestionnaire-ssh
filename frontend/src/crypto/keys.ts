/**
 * Module crypto E2EE — côté client uniquement.
 *
 * Flux :
 *   password + kdf_salt (serveur) → Argon2id (WASM via hash-wasm) → MasterKey (CryptoKey AES-256-GCM)
 *
 * La MasterKey ne quitte JAMAIS le navigateur.
 * Elle est stockée uniquement en mémoire (Zustand store), jamais persistée.
 */

import { argon2id } from 'hash-wasm'

interface KDFParams {
  m: number  // memorySize KB
  t: number  // iterations
  p: number  // parallelism
}

const DEFAULT_KDF_PARAMS: KDFParams = {
  m: 65536, // 64 MB
  t: 3,
  p: 4,
}

/**
 * Dérive la MasterKey à partir du mot de passe et du sel KDF fourni par le serveur.
 * Utilise Argon2id via WebAssembly (hash-wasm).
 */
export async function deriveMasterKey(
  password: string,
  kdfSaltB64: string,
  params: KDFParams = DEFAULT_KDF_PARAMS
): Promise<CryptoKey> {
  if (!window.isSecureContext || !crypto?.subtle) {
    throw new Error(
      'Contexte non sécurisé : accédez au site via HTTPS (https://...:8443). ' +
      `isSecureContext=${window.isSecureContext}, subtle=${!!crypto?.subtle}`
    )
  }

  const salt = base64ToUint8Array(kdfSaltB64)

  // Argon2id via WASM — ne bloque pas le thread principal grâce à l'async
  const hashHex = await argon2id({
    password,
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: 32,
    outputType: 'hex',
  })

  const keyBytes = hexToUint8Array(hashHex)

  return crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,           // non-extractable : la clé ne peut pas être exportée
    ['encrypt', 'decrypt']
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}
