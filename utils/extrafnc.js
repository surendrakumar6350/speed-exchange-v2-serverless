const generateTradeId = () => {
    const chars =
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let tradeId = "";
    for (let i = 0; i < 6; i++) {
        tradeId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return tradeId;
};


const generateInviteCode = () => {
    const chars =
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let inviteCode = "";
    for (let i = 0; i < 8; i++) {
        inviteCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return inviteCode;
};

module.exports = {generateInviteCode, generateTradeId}