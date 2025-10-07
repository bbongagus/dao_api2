import Redis from 'ioredis';

// Parse Redis URL if provided (Railway format)
const redisUrl = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL;

// Create Redis client instance
let redis;

if (redisUrl) {
  // Use connection URL (Railway, Heroku, etc.)
  console.log('📡 Connecting to Redis using URL...');
  redis = new Redis(redisUrl, {
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      console.log(`🔄 Redis retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false
  });
} else {
  // Use individual connection parameters (local development)
  console.log('📡 Connecting to Redis using host/port...');
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      console.log(`🔄 Redis retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false
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