import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('DAOBAK01');
const MAX_BYTES = 128 * 1024 * 1024;
export function backupKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('BACKUP_KEY_B64 must contain a base64-encoded 32-byte key');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('Invalid backup key');
  return key;
}
export function sealBackup(archive, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const clear = Buffer.from(JSON.stringify(archive));
  if (clear.length > MAX_BYTES) throw new Error('Backup exceeds the archive size limit');
  const ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}
export function openBackup(bytes, key) {
  if (bytes.length < 36 || bytes.length > MAX_BYTES + 36 || !bytes.subarray(0, 8).equals(MAGIC)) throw new Error('Invalid backup archive');
  let archive;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(8, 20));
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(bytes.subarray(20, 36));
    archive = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]).toString());
  } catch { throw new Error('Backup cannot be verified: wrong key or damaged file'); }
  if (archive?.version !== 1 || !Number.isSafeInteger(archive.createdAt) || !Array.isArray(archive.entries)) throw new Error('Invalid backup contents');
  const seen = new Set();
  for (const row of archive.entries) {
    if (!row || typeof row.key !== 'string' || seen.has(row.key)
      || typeof row.dump !== 'string' || !row.dump || Buffer.from(row.dump, 'base64').toString('base64') !== row.dump
      || !(row.expiresAt === null || (Number.isSafeInteger(row.expiresAt) && row.expiresAt >= 0))) throw new Error('Invalid backup entry');
    seen.add(row.key);
  }
  return archive;
}

// DUMP and TTL must be read together: expiry between the two must not turn a
// short-lived key into one that lives forever. Each graph is one Redis value.
const SNAPSHOT_KEY = "local d=redis.call('DUMP',KEYS[1]); if not d then return {} end; return {d,redis.call('PTTL',KEYS[1])}";
export async function collectBackup(redis, now = Date.now) {
  const entries = [];
  const seen = new Set();
  let cursor = '0', size = 0;
  const createdAt = now();
  do {
    const [next, keys] = await redis.scan(cursor, 'COUNT', 500);
    cursor = next;
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      const at = now();
      const [dump, ttl] = await redis.evalBuffer(SNAPSHOT_KEY, 1, key);
      if (!dump || ttl === -2 || ttl === 0) continue;
      if (ttl !== -1 && (!Number.isSafeInteger(ttl) || ttl < 0)) throw new Error('Invalid key lifetime');
      const row = { key, dump: dump.toString('base64'), expiresAt: ttl < 0 ? null : at + ttl };
      size += Buffer.byteLength(JSON.stringify(row));
      if (size > MAX_BYTES) throw new Error('Backup exceeds the archive size limit');
      entries.push(row);
    }
  } while (cursor !== '0');
  return { version: 1, createdAt, entries };
}
export async function restoreBackup(redis, archive, now = Date.now) {
  if (await redis.dbsize()) throw new Error('Restore requires an empty local database');
  let restored = 0, expired = 0;
  for (const row of archive.entries) {
    const ttl = row.expiresAt === null ? 0 : row.expiresAt - now();
    if (row.expiresAt !== null && ttl <= 0) { expired++; continue; }
    // Never REPLACE: refuse a collision rather than overwrite another writer.
    await redis.restore(row.key, ttl, Buffer.from(row.dump, 'base64'));
    restored++;
  }
  return { restored, expired };
}
