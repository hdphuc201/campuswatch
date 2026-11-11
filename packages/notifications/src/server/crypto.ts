import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const VERSION = 'v1';
const AAD = Buffer.from('campuswatch:telegram-chat-id:v1');

/** Encrypts Telegram chat identifiers at rest (AES-256-GCM) and hashes them for lookups. */
export interface ChatIdCipher {
  encrypt(chatId: string): string;
  /** Throws if the value was tampered with or encrypted with another key. */
  decrypt(value: string): string;
  /** Keyed hash (HMAC-SHA256) used to find a link by chat id without decrypting all rows. */
  hash(chatId: string): string;
}

/** `ENCRYPTION_KEY` must be 32 random bytes, base64 or base64url encoded. */
export function parseEncryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

export function createChatIdCipher(encodedKey: string): ChatIdCipher {
  const key = parseEncryptionKey(encodedKey);
  const hashKey = createHmac('sha256', key).update('campuswatch:chat-id-hash').digest();

  return {
    encrypt(chatId) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(AAD);
      const ciphertext = Buffer.concat([cipher.update(chatId, 'utf8'), cipher.final()]);
      return [VERSION, iv, ciphertext, cipher.getAuthTag()]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
        .join('.');
    },
    decrypt(value) {
      const [version, iv, ciphertext, tag] = value.split('.');
      if (version !== VERSION || !iv || !ciphertext || !tag) {
        throw new Error('Unrecognized encrypted value');
      }
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(AAD);
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
    hash(chatId) {
      return createHmac('sha256', hashKey).update(chatId).digest('hex');
    },
  };
}

/** Constant-time string comparison for shared secrets (webhook secret token). */
export function secretsEqual(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string') {
    return false;
  }
  const a = createHmac('sha256', 'compare').update(provided).digest();
  const b = createHmac('sha256', 'compare').update(expected).digest();
  return timingSafeEqual(a, b);
}
