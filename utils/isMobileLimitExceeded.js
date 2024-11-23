async function isMobileLimitExceeded(Mobile, redisClient) {

    // Define rate limit parameters
    const RATE_LIMIT = 4; // Maximum number of requests allowed
    const EXPIRATION_TIME = 60; // Time window in seconds

    if (!Mobile) {
        return true;
    }

    // Get the current request count for the Mobile
    const currentCountForThisMobile = await redisClient.get(Mobile);

    if (!currentCountForThisMobile) {
        // If no count exists, set it to 1 and set expiration
        await redisClient.set(Mobile, 1);
        await redisClient.expire(Mobile, EXPIRATION_TIME);
        return false;
    } else {
        // Increment the count for the Mobile
        const newCount = Number(currentCountForThisMobile) + 1;

        if (newCount > RATE_LIMIT) {
            return true; 
        } else {
            // Update the count and reset expiration
            await redisClient.set(Mobile, newCount);
            await redisClient.expire(Mobile, EXPIRATION_TIME);
            return false;
        }
    }
}

module.exports = isMobileLimitExceeded;