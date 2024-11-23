const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  transactions: [
    {
      transactionId: {
        type: String,
        required: true,
      },
      type: {
        type: String,
        enum: ['deposit', 'withdrawal', 'transfer'],
        required: true,
      },
      amount: {
        type: Number,
        required: true,
        min: 0.01,
      },
      status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending',
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Middleware to update the `updatedAt` field automatically
walletSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet;
