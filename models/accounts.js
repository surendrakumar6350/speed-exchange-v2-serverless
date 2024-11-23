const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    whatsappNumber: {
      type: String, 
      required: true,
      unique: true, 
      match: /^[\d]{10,15}$/, 
    },
    password: {
      type: String,
      required: true,
      minlength: 2,
    },
    promoCode: {
      type: String,
      required: false,
    },
    inviteCode: {
      type: String,
      required: true,
      unique: true,
    },
    tradeId: {
      type: String,
      required: true,
      unique: true,
    },
  }, {
    timestamps: true,
  });
  
module.exports = mongoose.model('accounts', userSchema);
