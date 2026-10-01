/** Encrypted read-only backup; restore only into an empty local Redis. No .env is loaded. */
import { readFile, writeFile } from 'node:fs/promises';
import Redis from 'ioredis';
import { opsRedisUrl, restoreRefusal } from '../src/ops/redisTarget.js';
import { backupKey, collectBackup, sealBackup, openBackup, restoreBackup } from '../src/ops/backupArchive.js';

const [command, file] = process.argv.slice(2);
let redis;
try {
  if (!['backup', 'restore'].includes(command) || !file) throw new Error('Usage: node scripts/backup-encrypted.js backup|restore <file.daobak>');
  const key = backupKey(process.env.BACKUP_KEY_B64);
  const archive = command === 'restore' ? openBackup(await readFile(file), key) : null;
  const url = command === 'restore' ? process.env.REDIS_URL : opsRedisUrl(process.env);
  if (!url) throw new Error('Set REDIS_URL explicitly');
  redis = new Redis(url, { family: 0, lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null, connectTimeout: 10000 });
  redis.on('error', () => {});
  if (command === 'restore') {
    const refusal = restoreRefusal({ host: redis.options.host, keyCount: null });
    if (refusal) throw new Error(refusal);
  }
  await redis.connect();
  if (command === 'backup') {
    const snapshot = await collectBackup(redis);
    await writeFile(file, sealBackup(snapshot, key), { flag: 'wx', mode: 0o600 });
    console.log(`Encrypted backup written: ${snapshot.entries.length} keys.`);
  } else {
    const result = await restoreBackup(redis, archive);
    console.log(`Restore complete: ${result.restored} keys restored; ${result.expired} expired keys skipped.`);
  }
} catch {
  // Redis errors may include commands, key names or credentials. Keep logs clean.
  console.error('Backup operation failed. Check the command, key, file, connection, and empty local restore target.');
  process.exitCode = 1;
} finally { redis?.disconnect(); }
