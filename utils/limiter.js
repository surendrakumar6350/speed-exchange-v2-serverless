const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { createClient } = require('redis');

// Create a Redis client
const redisClient = createClient({
    url: process.env.REDIS_URI, // e.g., "redis://<host>:<port>"
});

redisClient.connect().catch(console.error);

// Set up rate limiting
const limiter = rateLimit({
    store: new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per `windowMs`
    message: "Too many requests, please try again later.",
});

module.exports = {limiter}