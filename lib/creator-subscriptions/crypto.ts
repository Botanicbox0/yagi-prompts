import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { BillingKeyCipher } from './types';

/** Dedicated 32-byte base64 key, independent of provider and application signing keys. */
export function createBillingKeyCipher(encodedKey: string): BillingKeyCipher {
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new Error('Invalid billing encryption configuration');
  return {
    encrypt(value, context) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(context));
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
    },
    decrypt(value, context) {
      try {
        const [version, iv, tag, body, extra] = value.split('.');
        if (version !== 'v1' || !iv || !tag || !body || extra) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        decipher.setAAD(Buffer.from(context));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
      } catch { throw new Error('Billing key could not be decrypted'); }
    },
  };
}
