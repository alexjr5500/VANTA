// Device-local screen lock. Not an authentication boundary or encryption.
const PREFIX = 'vanta_chat_lock_v1:';
const ITERATIONS = 600000;
export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 60000;
type RecordV1 = { version: 1; salt: string; digest: string; failures: number; retryAt: number };

export const chatLockKey = (userId: string) => PREFIX + userId;
export const validChatPin = (pin: string) => /^\d{6}$/.test(pin);
const hex = (bytes: Uint8Array) => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => Uint8Array.from(value.match(/.{2}/g) || [], n => parseInt(n, 16));

export function parseChatLock(raw: string | null): RecordV1 | null {
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !/^[0-9a-f]{32}$/.test(value.salt) || !/^[0-9a-f]{64}$/.test(value.digest)
    || !Number.isInteger(value.failures) || value.failures < 0 || value.failures >= MAX_ATTEMPTS
    || !Number.isFinite(value.retryAt) || value.retryAt < 0) throw new Error('Chat lock data cannot be read.');
  return value;
}

export function readChatLock(userId: string) {
  return parseChatLock(localStorage.getItem(chatLockKey(userId)));
}

async function digest(pin: string, salt: string) {
  if (!globalThis.crypto?.subtle) throw new Error('Secure passcodes are unavailable on this device.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: ITERATIONS }, key, 256);
  return hex(new Uint8Array(bits));
}

const write = (userId: string, record: RecordV1) => localStorage.setItem(chatLockKey(userId), JSON.stringify(record));

async function verify(userId: string, pin: string) {
  const record = readChatLock(userId);
  if (!record) throw new Error('Chat passcode is not configured.');
  if (record.retryAt > Date.now()) throw new Error('Too many attempts. Try again in ' + Math.ceil((record.retryAt - Date.now()) / 1000) + ' seconds.');
  if (!validChatPin(pin)) throw new Error('Enter your six-digit passcode.');
  const candidate = await digest(pin, record.salt);
  // Never update a record which was replaced by another tab during hashing.
  const latest = readChatLock(userId);
  if (!latest || latest.digest !== record.digest || latest.salt !== record.salt) throw new Error('Chat passcode changed. Try again.');
  if (latest.retryAt > Date.now()) throw new Error('Too many attempts. Try again shortly.');
  if (candidate !== latest.digest) {
    const failures = latest.failures + 1;
    write(userId, { ...latest, failures: failures >= MAX_ATTEMPTS ? 0 : failures, retryAt: failures >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0 });
    throw new Error(failures >= MAX_ATTEMPTS ? 'Too many attempts. Try again in 60 seconds.' : 'Incorrect passcode.');
  }
  write(userId, { ...latest, failures: 0, retryAt: 0 });
}

export async function verifyChatPin(userId: string, pin: string) { await verify(userId, pin); }

export async function setChatPin(userId: string, newPin: string, currentPin?: string) {
  if (!validChatPin(newPin)) throw new Error('Choose a six-digit passcode.');
  const existing = readChatLock(userId);
  if (existing) await verify(userId, currentPin || '');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hashed = await digest(newPin, salt);
  const latest = readChatLock(userId);
  if (latest?.digest !== existing?.digest || latest?.salt !== existing?.salt) throw new Error('Passcode changed in another window. Try again.');
  write(userId, { version: 1, salt, digest: hashed, failures: 0, retryAt: 0 });
}

export async function removeChatPin(userId: string, currentPin: string) {
  const existing = readChatLock(userId);
  await verify(userId, currentPin);
  const latest = readChatLock(userId);
  if (!latest || latest.digest !== existing?.digest || latest.salt !== existing?.salt) throw new Error('Passcode changed. Try again.');
  localStorage.removeItem(chatLockKey(userId));
}
