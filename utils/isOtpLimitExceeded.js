async function isOtpLimitExceeded(app, redisClient) {

    // Define rate limit parameters
    const RATE_LIMIT = 60; // Maximum number of requests allowed
    const EXPIRATION_TIME = 600; // Time window in seconds

    if (!app) {
        return true;
    }

    // Get the current request count for the app
    const currentCountForThisapp = await redisClient.get(app);

    if (!currentCountForThisapp) {
        // If no count exists, set it to 1 and set expiration
        await redisClient.set(app, 1);
        await redisClient.expire(app, EXPIRATION_TIME);
        return false;
    } else {
        // Increment the count for the app
        const newCount = Number(currentCountForThisapp) + 1;

        if (newCount > RATE_LIMIT) {
            return true; 
        } else {
            // Update the count and reset expiration
            await redisClient.set(app, newCount);
            await redisClient.expire(app, EXPIRATION_TIME);
            return false;
        }
    }
}

module.exports = isOtpLimitExceeded;