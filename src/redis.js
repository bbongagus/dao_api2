import Redis from 'ioredis';

// Railway provides individual variables which work better than REDIS_URL
// Try individual params first (Railway REDISHOST, REDISPORT, REDISPASSWORD)
// Then fall back to URL format
// Then fall back to localhost

let redis;

const redisHost = process.env.REDISHOST || process.env.REDIS_HOST;
const redisPort = process.env.REDISPORT || process.env.REDIS_PORT;
const redisPassword = process.env.REDISPASSWORD || process.env.REDIS_PASSWORD;
const redisUrl = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL;

if (redisHost && redisPort) {
  // Use individual connection parameters (Railway or local)
  console.log(`📡 Connecting to Redis using host/port: ${redisHost}:${redisPort}`);
  redis = new Redis({
    host: redisHost,
    port: parseInt(redisPort),
    password: redisPassword || undefined,
    retryStrategy: (times) => {
      if (times > 20) {
        console.error('❌ Redis retry limit reached');
        return null;
      }
      const delay = Math.min(times * 50, 2000);
      console.log(`🔄 Redis retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    connectTimeout: 10000
  });
} else if (redisUrl) {
  // Use connection URL (fallback)
  console.log('📡 Connecting to Redis using URL...');
  redis = new Redis(redisUrl, {
    retryStrategy: (times) => {
      if (times > 20) {
        console.error('❌ Redis retry limit reached');
        return null;
      }
      const delay = Math.min(times * 50, 2000);
      console.log(`🔄 Redis retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    connectTimeout: 10000
  });
} else {
  // Fallback to localhost
  console.log('📡 Connecting to Redis using localhost (no env vars found)');
  redis = new Redis({
    host: 'localhost',
    port: 6379,
    retryStrategy: (times) => {
      if (times > 20) {
        console.error('❌ Redis retry limit reached');
        return null;
      }
      const delay = Math.min(times * 50, 2000);
      console.log(`🔄 Redis retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    connectTimeout: 10000
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