import Redis from 'ioredis';
import { redisRetryDelay } from './redisRetry.js';

// Railway Redis connection with IPv6 support
// Railway uses IPv6 network, need to set family: 0 for auto-detection

let redis;

const redisHost = process.env.REDISHOST || process.env.REDIS_HOST;
const redisPort = process.env.REDISPORT || process.env.REDIS_PORT;
const redisPassword = process.env.REDISPASSWORD || process.env.REDIS_PASSWORD;
const redisUrl = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL;

// Common Redis options with IPv6 support
const commonOptions = {
  family: 0, // 0 = auto-detect IPv4/IPv6, 4 = IPv4 only, 6 = IPv6 only
  // Never stop reconnecting: Redis holds every graph, so a server that has
  // given up can serve nothing. See redisRetry.js.
  retryStrategy: (times) => {
    const delay = redisRetryDelay(times);
    // Loud at first, then quiet — an outage should not fill the log with a
    // line every two seconds for hours.
    if (times <= 5 || times % 30 === 0) {
      console.log(`🔄 Redis retry attempt ${times}, waiting ${delay}ms`);
    }
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  connectTimeout: 10000
};

if (redisHost && redisPort) {
  // Use individual connection parameters (Railway or local)
  console.log(`📡 Connecting to Redis: ${redisHost}:${redisPort} (IPv4/IPv6 auto)`);
  redis = new Redis({
    host: redisHost,
    port: parseInt(redisPort),
    password: redisPassword || undefined,
    ...commonOptions
  });
} else if (redisUrl) {
  // Use connection URL (fallback)
  console.log('📡 Connecting to Redis using URL (IPv4/IPv6 auto)');
  redis = new Redis(redisUrl, commonOptions);
} else {
  // Fallback to localhost
  console.log('📡 Connecting to Redis: localhost:6379 (development)');
  redis = new Redis({
    host: 'localhost',
    port: 6379,
    ...commonOptions
  });
}

redis.on('connect', () => {
  console.log('✅ Redis connected successfully');
});

redis.on('ready', () => {
  console.log('✅ Redis ready to accept commands');
});

redis.on('error', (error) => {
  console.error('❌ Redis connection error:', error.message);
});

redis.on('close', () => {
  console.log('⚠️  Redis connection closed');
});

redis.on('reconnecting', () => {
  console.log('🔄 Redis reconnecting...');
});

export default redis;