import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const BCRYPT_ROUNDS = 12;
const API_KEY_PREFIX = 'cai_live_';

/**
 * Hash a plaintext password using bcrypt with 12 rounds
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
}

/**
 * Compare a plaintext password against a bcrypt hash
 */
export async function comparePassword(plainPassword: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, hash);
}

/**
 * Generate a new API key with a recognizable prefix
 * Returns the raw key (shown to the user once) and its SHA-256 hash (stored in DB)
 */
export function generateApiKey(): { rawKey: string; keyHash: string } {
  const randomPart = crypto.randomBytes(32).toString('hex');
  const rawKey = `${API_KEY_PREFIX}${randomPart}`;
  const keyHash = hashApiKey(rawKey);
  return { rawKey, keyHash };
}

/**
 * Hash an API key using SHA-256 for secure storage and lookup
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}
