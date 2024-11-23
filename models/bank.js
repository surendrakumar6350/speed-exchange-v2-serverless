const mongoose = require('mongoose');

const bankAccountSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    accountNo: {
        type: String,
        required: true,
        unique: true,
    },
    accountName: {
        type: String,
        required: true,
    },
    ifsc: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

const BankAccount = mongoose.model('BankAccount', bankAccountSchema);

module.exports = BankAccount;
