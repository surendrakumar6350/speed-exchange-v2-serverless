const mongoose = require('mongoose');

const usdtWalletSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true
    },
    walletAddress: {
        type: String,
        required: true,
        unique: true,
    },
    createdAt: {
        type: Date,
        default: Date.now, 
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    }
});


const UsdtWallet = mongoose.model('UsdtWallet', usdtWalletSchema);

module.exports = UsdtWallet;
