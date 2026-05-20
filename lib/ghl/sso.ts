/**
 * Decrypt the encrypted SSO session key that GHL passes when our app is
 * embedded as a Custom Page (iframe) inside the GHL UI.
 *
 * Mirrors the official GHL marketplace template's `decryptSSOData`:
 *   - AES-256-CBC
 *   - OpenSSL "Salted__" envelope (8-byte salt at byte offset 8)
 *   - Key + IV derived via MD5(password + salt) → MD5(prev + password + salt) → ...
 *     (the EVP_BytesToKey / PBKDF1-style derivation OpenSSL uses by default)
 *
 * Returns the decrypted JSON payload, which typically looks like:
 *   {
 *     userId: string,
 *     companyId: string,
 *     activeLocation: string,
 *     userName: string,
 *     email: string,
 *     role: string,
 *     type: "agency" | "location",
 *     ...
 *   }
 *
 * Used by /api/oauth/decrypt-sso. The browser sends the encrypted key it
 * received from GHL's parent iframe via postMessage; the server decrypts
 * with the SSO_KEY shared secret from the app's marketplace settings.
 */
import { createDecipheriv, createHash } from "node:crypto";

export interface GhlSsoPayload {
  userId?: string;
  companyId?: string;
  activeLocation?: string;
  userName?: string;
  email?: string;
  role?: string;
  type?: "agency" | "location" | string;
  [key: string]: unknown;
}

export function decryptGhlSsoKey(encryptedBase64: string): GhlSsoPayload {
  const ssoKey = process.env.GHL_APP_SSO_KEY;
  if (!ssoKey) {
    throw new Error("GHL_APP_SSO_KEY env var is not set");
  }

  const blockSize = 16;
  const keySize = 32;
  const ivSize = 16;
  const saltSize = 8;

  const rawEncryptedData = Buffer.from(encryptedBase64, "base64");
  if (rawEncryptedData.length < blockSize) {
    throw new Error("Encrypted key too short");
  }
  // OpenSSL envelope is bytes 0-7 = "Salted__", bytes 8-15 = salt.
  const salt = rawEncryptedData.subarray(saltSize, blockSize);
  const cipherText = rawEncryptedData.subarray(blockSize);

  // Derive key + IV (PBKDF1-style with MD5, OpenSSL EVP_BytesToKey).
  let derived = Buffer.alloc(0);
  while (derived.length < keySize + ivSize) {
    const hasher = createHash("md5");
    derived = Buffer.concat([
      derived,
      hasher
        .update(
          Buffer.concat([
            derived.subarray(-ivSize),
            Buffer.from(ssoKey, "utf-8"),
            salt,
          ]),
        )
        .digest(),
    ]);
  }

  const decipher = createDecipheriv(
    "aes-256-cbc",
    derived.subarray(0, keySize),
    derived.subarray(keySize, keySize + ivSize),
  );
  const decrypted = decipher.update(cipherText);
  const finalDecrypted = Buffer.concat([decrypted, decipher.final()]);
  return JSON.parse(finalDecrypted.toString()) as GhlSsoPayload;
}
