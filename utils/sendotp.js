const axios = require('axios')
require('dotenv').config();

async function sendotp(data) {
    try {
        const response = await axios.post(`${process.env.SEND_OTP_BOT_API}`, data);
        return response.data;
    } catch (error) {
        console.error('Error sending message:', error);
        return null;
    }
}

module.exports = { sendotp };