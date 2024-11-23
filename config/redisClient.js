const { createClient } = require('redis');
require('dotenv').config();

const redisClient = createClient({
  url: process.env.REDIS_URI,
  socket: {
    reconnectStrategy: (retries = 3) => {
      if (retries < 10) {
        return Math.min(retries * 1000, 3000); // Retry strategy
      }
      return false; // Stop reconnecting after 10 retries
    }
  }
});

// Connect to Redis
const connectRedis = async () => {
  if (!redisClient.isReady) {  // Use isReady instead of isOpen
    try {
      await redisClient.connect();
    } catch (err) {
      console.error('Redis connection error:', err);
    }
  }
};

// Close Redis client
const closeRedisClient = async () => {
  if (redisClient.isReady) {  // Check if Redis is connected before quitting
    try {
      await redisClient.quit();
    } catch (err) {
      console.error('Error closing Redis connection:', err);
    }
  } else {
    console.log('Redis client is not open, no need to close');
  }
};

// Redis client event listeners
redisClient.on('error', (err) => {
  console.error('Redis error:', err);
});



module.exports = { redisClient, connectRedis, closeRedisClient };
