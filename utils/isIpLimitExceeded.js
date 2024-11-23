async function isIpLimitExceeded(ip, redisClient) {

    // Define rate limit parameters
    const RATE_LIMIT = 5; // Maximum number of requests allowed
    const EXPIRATION_TIME = 60; // Time window in seconds

    if (!ip) {
        return true;
    }

    // Get the current request count for the IP
    const currentCountForThisIp = await redisClient.get(ip);

    if (!currentCountForThisIp) {
        // If no count exists, set it to 1 and set expiration
        await redisClient.set(ip, 1);
        await redisClient.expire(ip, EXPIRATION_TIME);
        return false;
    } else {
        // Increment the count for the IP
        const newCount = Number(currentCountForThisIp) + 1;

        if (newCount > RATE_LIMIT) {
            return true; 
        } else {
            // Update the count and reset expiration
            await redisClient.set(ip, newCount);
            await redisClient.expire(ip, EXPIRATION_TIME);
            return false;
        }
    }
}

module.exports = isIpLimitExceeded;