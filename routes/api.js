const express = require("express");
const accounts = require("../models/accounts");
const {
    redisClient,
    connectRedis,
    closeRedisClient,
} = require("../config/redisClient");
const { sendotp } = require("../utils/sendotp");
const isIpLimitExceeded = require("../utils/isIpLimitExceeded");
const isOtpLimitExceeded = require("../utils/isOtpLimitExceeded");
const isMobileLimitExceeded = require("../utils/isMobileLimitExceeded");
const Wallet = require("../models/wallet");
const Payment = require("../models/payment");
const UsdtWallet = require("../models/usdtWallet");
const BankAccount = require("../models/bank");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require('bcryptjs');
const axios = require("axios");
const multer = require("multer");
const { generateInviteCode, generateTradeId } = require("../utils/extrafnc");
const logMessage = require("../utils/log");
const { connectToDatabase } = require("../models/db/connect");

const router = express.Router();
const upload = multer();

router.post("/send-otp", async function (req, res) {
    try {
        await connectToDatabase();
        let data = req.body;
        // Connect to Redis and fetch IP from headers
        await connectRedis();
        const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        const clientIp = ip.split(',')[0];
        logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify(data)}`);

        // Check OTP limit
        if (await isOtpLimitExceeded("app", redisClient)) {
            return res.status(503).json({
                success: false,
                message: "Server Busy",
            });
        }

        // Check mobile and IP request limits
        if (
            (await isMobileLimitExceeded(data.whatsappNumber, redisClient)) ||
            (ip && (await isIpLimitExceeded(ip, redisClient)))
        ) {
            return res.status(429).json({
                success: false,
                message: "Too many requests",
            });
        }

        // Send OTP
        const response = await sendotp({
            SIGNUP_KEY: process.env.SIGNUP_KEY,
            mobile: data.whatsappNumber,
        });
        if (!response) {
            return res.status(400).json({
                success: false,
                message: "API error",
            });
        }

        // Connect to the database and check if the user already exists
        const existingUser = await accounts.findOne({
            whatsappNumber: data.whatsappNumber,
        });
        const returnResponse = {
            success: true,
            allReadyRegistered: !!existingUser,
            message: "New OTP sent successfully",
        };

        // Store OTP in Redis with a 15-minute expiration
        await redisClient.set(`M${data.whatsappNumber}`, JSON.stringify(response));
        await redisClient.expire(`M${data.whatsappNumber}`, 900); // Expire in 15 minutes

        res.status(200).json(returnResponse);
    } catch (error) {
        console.error("API error:", error);
        res.status(500).json({
            success: false,
            message: "API error",
        });
    } finally {
        // Ensure Redis connection is closed
        await closeRedisClient();
    }
});

router.post("/verify-otp", async function (req, res) {
    try {
        let data = req.body;
        const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
        const clientIp = ip.split(',')[0];
        logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify(data)}`);

        // Basic validation for required fields
        if (!data.whatsappNumber || !data.password || !data.otp) {
            return res.status(200).json({
                success: false,
                message: "Missing whatsappNumber or password",
            });
        }

        // Validate whatsappNumber format using the regex in the schema
        const phoneRegex = /^\d{10,15}$/;
        if (!phoneRegex.test(data.whatsappNumber)) {
            return res.status(200).json({
                success: false,
                message: "Invalid whatsappNumber format",
            });
        }

        await connectRedis();
        await connectToDatabase();

        // Fetch OTP from Redis
        let result = await redisClient.get(`M${data.whatsappNumber}`);
        if (!result) {
            return res.status(200).json({
                success: false,
                message: "Otp Expired, please try again",
            });
        }

        // Parse and verify OTP
        const response = JSON.parse(result);
        if (response.otp !== data.otp) {
            return res.status(200).json({
                success: false,
                message: "Wrong Otp",
            });
        }

        // Check if user already exists
        const existingUser = await accounts.findOne({
            whatsappNumber: data.whatsappNumber,
        });
        if (existingUser?._id) {
            // Send response with user ID in a cookie
            res.cookie("user", existingUser._id, {
                expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // Expires in 30 days
                httpOnly: true, // Prevents client-side access (XSS protection)
                sameSite: "None", // Required for cross-origin (use 'Strict' or 'Lax' if not cross-origin)
                path: "/",
            });
            res.set("Authorization", `Bearer ${existingUser._id}`);
            return res.status(200).json({
                success: true,
                token: existingUser._id,
            });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(data.password, saltRounds);

        // Generate inviteCode and tradeId
        const inviteCode = generateInviteCode();
        const tradeId = generateTradeId();

        const newUser = new accounts({
            whatsappNumber: data.whatsappNumber,
            password: hashedPassword,
            promoCode: data.promoCode || "TEMP12345",
            inviteCode: inviteCode,
            tradeId: tradeId,
        });

        const savedUser = await newUser.save();

        const newWallet = new Wallet({
            userId: savedUser._id,
            balance: 0,
            transactions: [],
        });

        await newWallet.save();

        // Send success response with user ID in a cookie
        res.cookie("user", savedUser._id, {
            expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // Expires in 30 days
            httpOnly: true,
            sameSite: "None",
            path: "/",
        });

        // Use savedUser._id for Authorization header and token
        res.set("Authorization", `Bearer ${savedUser._id}`);
        return res.status(200).json({
            success: true,
            token: savedUser._id,
        });
    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({
            success: false,
            message: "API error",
        });
    } finally {
        // Close the Redis connection after all operations
        await closeRedisClient();
    }
});

router.post("/login", async function (req, res) {
    try {
        let data = req.body;

        const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
        const clientIp = ip.split(',')[0];
        logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify(data)}`);
        await connectToDatabase();
        // Basic validation for required fields
        if (!data.whatsappNumber || !data.password) {
            return res.status(200).json({
                success: false,
                message: "Missing whatsappNumber or password",
            });
        }

        // Validate whatsappNumber format using the regex in the schema
        const phoneRegex = /^\d{10,15}$/;
        if (!phoneRegex.test(data.whatsappNumber)) {
            return res.status(200).json({
                success: false,
                message: "Invalid whatsappNumber format",
            });
        }

        const existingUser = await accounts.findOne({
            whatsappNumber: data.whatsappNumber,
        });
        if (!existingUser) {
            return res.status(200).json({
                success: false,
                message: "User not found",
            });
        }
        if (existingUser?._id) {
            const isPasswordValid = await bcrypt.compare(
                data.password,
                existingUser.password
            );
            if (!isPasswordValid) {
                return res.status(200).json({
                    success: false,
                    message: "Invalid Password",
                });
            }

            // Send response with user ID in a cookie
            res.cookie("user", existingUser._id, {
                expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
                httpOnly: true,
                sameSite: "None",
                path: "/",
            });
            res.set("Authorization", `Bearer ${existingUser._id}`);
            return res.status(200).json({
                success: true,
                token: existingUser._id,
                message: "Login successful",
            });
        }
    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({
            success: false,
            message: "API error",
        });
    }
});

router.post("/transactions/add-money", async (req, res) => {
    try {
        const { userId, type, amount, transactionId } = req.body;
        const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
        const clientIp = ip.split(',')[0];
        logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify({ userId, type, amount, transactionId })}`);
        await connectToDatabase();
        // Validate input
        if (!userId || !type || !amount) {
            return res
                .status(200)
                .json({
                    success: false,
                    message: "User ID, type, and amount are required.",
                });
        }

        if (amount < 1) {
            return res
                .status(200)
                .json({ success: false, message: "Amount is Too Low" });
        }
        if (transactionId.length < 7) {
            return res
                .status(200)
                .json({ success: false, message: "Invalid transactionId" });
        }

        // Find the user's wallet
        let wallet = await Wallet.findOne({ userId });

        // If wallet doesn't exist, create a new one
        if (!wallet) {
            wallet = new Wallet({ userId });
        }

        // Add or update the new transaction
        wallet.transactions.push({
            transactionId,
            type,
            amount,
            status: "pending", // Default status
        });

        // Save the updated wallet
        await wallet.save();

        res.status(200).json({
            success: true,
            message: "Transaction created and added to the wallet.",
            transaction: { transactionId, type, amount, status: "pending" },
            wallet,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});

router.post("/transactions/withdraw", async (req, res) => {
    try {
        const { userId, amount } = req.body;
        const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
        const clientIp = ip.split(',')[0];
        logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify({ userId, amount })}`);
        await connectToDatabase();

        // Validate input
        if (!userId || !amount) {
            return res
                .status(200)
                .json({ success: false, message: "User ID and amount are required." });
        }
        if (amount <= 0) {
            return res
                .status(200)
                .json({
                    success: false,
                    message: "Withdrawal amount must be greater than zero.",
                });
        }

        // Find the user's wallet
        let wallet = await Wallet.findOne({ userId });

        // If wallet doesn't exist, create a new one
        if (!wallet) {
            wallet = new Wallet({ userId, transactions: [] });
        }

        // Check if the wallet has sufficient balance
        if (wallet.balance < amount) {
            return res
                .status(200)
                .json({
                    success: false,
                    message: "Insufficient balance for this withdrawal.",
                });
        }

        // Generate a unique transaction ID
        const transactionId = uuidv4();
        if (!transactionId) {
            return res
                .status(500)
                .json({
                    success: false,
                    message: "Failed to generate transaction ID.",
                });
        }

        // Add the new withdrawal transaction
        wallet.transactions.push({
            transactionId,
            type: "withdrawal",
            amount,
            status: "pending", // Default status
        });

        // Deduct the amount from the wallet balance
        wallet.balance -= amount;
        wallet.balance = parseFloat(wallet.balance.toFixed(2)); // Ensure consistent decimal format

        // Save the updated wallet
        await wallet.save();

        res.status(201).json({
            success: true,
            message: "Withdrawal transaction created successfully.",
            transaction: {
                transactionId,
                type: "withdrawal",
                amount,
                status: "pending",
            },
            wallet,
        });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});

router.post("/wallet-status", async function (req, res) {
    try {
        const { userId } = req.body;
        const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
        const clientIp = ip.split(',')[0];
        logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify({ userId })}`);
        await connectToDatabase();

        if (!userId) {
            return res.status(400).json({ error: "User ID is required" });
        }

        let wallet = await Wallet.findOne({ userId });

        if (wallet) {
            return res.status(200).json({
                success: true,
                message: "Wallet found",
                wallet: {
                    balance: wallet.balance,
                    transactions: wallet.transactions,
                },
            });
        }
    } catch (error) {
        console.error("Error checking wallet status:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

router.get("/pending-transactions", async (req, res) => {
    await connectToDatabase();
    function formatISOToSimpleTimeInZone(isoString, timeZone) {
        const date = new Date(isoString);
        return new Intl.DateTimeFormat("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
            timeZone: timeZone,
        }).format(date);
    }

    try {
        const wallets = await Wallet.find();

        const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        const clientIp = ip.split(',')[0];
        logMessage(`someone requested ${req.path} from ${clientIp}`);

        const tempData = {
            deposits: [],
            withdrawals: [],
        };

        for (const wallet of wallets) {
            for (const transaction of wallet.transactions) {
                if (transaction.status === "pending") {
                    const account = await accounts.findOne({ _id: wallet.userId });
                    const formattedTransaction = {
                        id: transaction.transactionId,
                        userId: account.whatsappNumber,
                        amount: transaction.amount,
                        createdAt: formatISOToSimpleTimeInZone(
                            transaction.timestamp.toISOString(),
                            "Asia/Kolkata"
                        ),
                        fromWhichWallet: wallet._id,
                        _id: transaction._id,
                    };

                    if (transaction.type === "deposit") {
                        tempData.deposits.push(formattedTransaction);
                    } else if (transaction.type === "withdrawal") {
                        tempData.withdrawals.push(formattedTransaction);
                    }
                }
            }
        }
        res.json({ success: true, data: tempData });
    } catch (error) {
        console.error("Error fetching pending transactions:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.post("/update-ts-status", async (req, res) => {
    try {
        const { walletId, transactionId } = req.body;

        const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
        const clientIp = ip.split(',')[0];
        logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify({ walletId, transactionId })}`);
        await connectToDatabase();

        // Find the wallet by its ID
        const wallet = await Wallet.findById({ _id: walletId });
        if (!wallet) {
            return res
                .status(200)
                .json({ success: false, message: "Wallet not found" });
        }

        // Find the transaction within the wallet's transactions
        const transaction = wallet.transactions.id(transactionId);
        if (!transaction) {
            return res
                .status(200)
                .json({ success: false, message: "Transaction not found" });
        }

        // Update the transaction status
        transaction.status = "completed";

        if (transaction.type === "deposit") {
            wallet.balance += transaction.amount;
        }

        // Save the updated wallet document
        await wallet.save();

        res
            .status(200)
            .json({
                success: true,
                message: "Transaction updated successfully",
                transaction,
            });
    } catch (error) {
        console.error(error);
        res
            .status(500)
            .json({ success: false, message: "An error occurred", error });
    }
});

router.post("/verify-user", async (req, res) => {
    const { username } = req.body;

    const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
    const clientIp = ip.split(',')[0];
    logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify({ username })}`);
    await connectToDatabase();

    if (!username) {
        return res
            .status(400)
            .json({ success: false, message: "Username is required" });
    }

    try {
        // Check if the user exists in the accounts collection
        const user = await accounts.findOne({ _id: username });

        if (user) {
            return res.status(200).json({
                success: true,
                user: {
                    tradeId: user.tradeId,
                    inviteCode: user.inviteCode,
                    wallet: user.wallet,
                },
            });
        } else {
            return res
                .status(200)
                .json({ success: false, message: "User does not exist / Login first" });
        }
    } catch (error) {
        console.error("Error verifying user:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.post("/verify-admin", async (req, res) => {
    const { username } = req.body;

    const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
    const clientIp = ip.split(',')[0];
    logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify({ username })}`);
    await connectToDatabase();

    if (!username) {
        return res.status(200).json({ success: false, message: "Please Login" });
    }

    try {
        // Check if username exists in the database
        const adminUser = await accounts.findOne({ _id: username });
        if (!adminUser) {
            return res
                .status(200)
                .json({ success: false, message: "Please Login.." });
        }

        // Check if the provided WhatsApp number matches the admin's WhatsApp number in the .env file
        const isWhatsappAdmin = process.env.ADMIN_WHATSAPP_NUMBERS.split(
            ","
        ).includes(adminUser.whatsappNumber);

        if (adminUser && isWhatsappAdmin) {
            return res.json({ success: true, message: "Admin verified", adminUser });
        } else if (!adminUser) {
            return res
                .status(200)
                .json({
                    success: false,
                    message: "Admin username not found in the database",
                });
        } else if (!isWhatsappAdmin) {
            return res
                .status(200)
                .json({
                    success: false,
                    message: "WhatsApp number is not authorized as admin",
                });
        }
    } catch (error) {
        console.error("Error verifying admin:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.get('/create-new-address', async (req, res) => {
    try {

        const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
        const clientIp = ip.split(',')[0];
        logMessage(`someone requested ${req.path} from ${clientIp}`);
        await connectToDatabase();

        const admin_wallet_address = await UsdtWallet.findOne({ "id": "admin" });

        // const response = await axios.post(
        //     'https://coinremitter.com/api/v3/DOGE/get-new-address',
        //     {
        //         api_key: process.env.API_KEY_CRYPTO_KEY,
        //         password: process.env.CRYPTO_PASSWORD
        //     }
        // );
        // const data = response.data;

        if (!admin_wallet_address) {
            res.status(200).json({
                "flag": 1,
                "msg": "New address created successfully.",
                "action": "get-new-address",
                "data": {
                    "address": "DBwMa9T6wuGhPRGSyJaysYy9f4RLTfrUi2",
                    "label": "",
                    "qr_code": `https://quickchart.io/qr?margin=1&size=300&text=DBwMa9T6wuGhPRGSyJaysYy9f4RLTfrUi2`
                },
                "success": true
            });

        }

        res.status(200).json({
            "flag": 1,
            "msg": "New address created successfully.",
            "action": "get-new-address",
            "data": {
                "address": admin_wallet_address.walletAddress,
                "label": "",
                "qr_code": `https://quickchart.io/qr?margin=1&size=300&text=${admin_wallet_address.walletAddress}`
            },
            "success": true
        });

    } catch (error) {
        console.error('Error fetching DOGE address:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch DOGE address' });
    }
});

router.post("/withdraw-crypto", async (req, res) => {
    const { to_address, amount } = req.body;

    const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
    const clientIp = ip.split(',')[0];
    logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify({ to_address, amount })}`);
    await connectToDatabase();

    if (!to_address || !amount) {
        return res
            .status(400)
            .json({ success: false, message: "to_address and amount are required" });
    }
    try {
        const response = await axios.post(
            "https://coinremitter.com/api/v3/DOGE/withdraw",
            {
                api_key: process.env.API_KEY_CRYPTO_KEY,
                password: process.env.CRYPTO_PASSWORD,
                to_address,
                amount,
            }
        );

        const data = response.data;
        res.status(200).json({ ...data, success: true });
    } catch (error) {
        console.error("Error during DOGE withdrawal:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to withdraw DOGE",
            details: error.response ? error.response.data : error.message,
        });
    }
});

router.post("/webhook", upload.none(), async (req, res) => {
    // This api is only called by Coinremitter when someone pay on qr
    const userAgent = req.headers["user-agent"]; // Get the User-Agent header
    await connectToDatabase();

    if (userAgent === "Coinremitter/api") {
        const ans = req.body;

        // Check if the required fields are present
        if (!ans.address || !ans.txid || !ans.amount) {
            console.log("Invalid request received from Coinremitter.");
            res.status(400).send("Invalid request: Missing required fields.");
            return;
        }

        // Find the payment in the database
        const payment = await Payment.findOne({
            payment_wallet_address: ans.address,
            status: "pending",
        });

        if (!payment) {
            console.log("Payment not found in the database.");
            res.status(404).send("Payment not found.");
            return;
        }

        if (Number(ans.amount) < Number(payment.amount)) {
            console.log("Payment amount is less than expected.");
            return res.status(400).send("Payment amount is less than expected.");
        }

        // Update the payment status to 'completed' and save the updated document
        payment.status = "completed";
        payment.receivedDataFromWebhook = ans;
        await payment.save();

        const userWallet = await Wallet.findOne({ userId: payment.userId });

        if (!userWallet) {
            console.log("User wallet not found.");
            return res.status(404).send("User wallet not found.");
        }

        userWallet.balance += ans.amount;
        userWallet.save();

        res.status(200).send("balance updated successfully");
    } else {
        console.log("Unauthorized request.");
        res.status(403).send("Forbidden: Unauthorized request.");
    }
});

router.post("/admin/wallet", async (req, res) => {
    const { newWalletAddress } = req.body;

    const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
    const clientIp = ip.split(',')[0];
    logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify({ newWalletAddress })}`);
    await connectToDatabase();

    if (!newWalletAddress) {
        return res.status(200).json({ success: false, message: "New wallet address is required" });
    }

    if (!(newWalletAddress.length >= 10 && newWalletAddress.length <= 55)) {
        return res.status(200).json({ success: false, message: "Please Enter Valid Wallet Address" });
    }

    try {
        // Find the admin record by id and update walletAddress
        const updatedWallet = await UsdtWallet.findOneAndUpdate(
            { id: "admin" }, // Find record with id 'admin'
            { walletAddress: newWalletAddress, updatedAt: Date.now() }, // Update wallet address and set updatedAt
            { new: true, upsert: true } // Return the updated document
        );

        if (!updatedWallet) {
            return res.status(404).json({ message: "Admin wallet not found" });
        }

        res.status(200).json({ success: true, message: "Wallet address updated successfully", updatedWallet });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.post('/get-invite-accounts', async (req, res) => {
    const { userId } = req.body;

    const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
    const clientIp = ip.split(',')[0];
    logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify({ userId })}`);
    await connectToDatabase();

    if (!userId) {
        return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    try {
        // Step 1: Find the user profile in the accounts collection
        const userProfile = await accounts.findOne({ _id: userId });

        if (!userProfile) {
            return res.status(404).json({ success: false, message: 'User profile not found' });
        }

        const inviteCode = userProfile.inviteCode;

        // Step 2: Find all accounts that used this invite code as a promo code
        const invitedAccounts = await accounts.find({ promoCode: inviteCode }).select('-password -_id');

        res.status(200).json({ success: true, inviteCode, invitedAccounts });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

router.post('/add-bank-account', async (req, res) => {
    const { accountNo, accountName, ifsc, userId } = req.body;

    const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
    const clientIp = ip.split(',')[0];
    logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify({ accountNo, accountName, ifsc, userId })}`);
    await connectToDatabase();

    // Validate input
    if (!accountNo || !accountName || !ifsc) {
        return res.status(400).json({ success: false, message: 'Please fill all required fields' });
    }

    try {

        const ans = await BankAccount.find({ userId: userId });
        if (ans.length > 3) {
            return res.status(200).json({ success: false, message: 'You can add a maximum of 4 bank accounts' });
        }
        // Create and save new bank account
        const newBankAccount = new BankAccount({
            accountNo,
            accountName,
            ifsc,
            userId
        });
        await newBankAccount.save();

        res.status(201).json({ success: true, message: 'Bank account added successfully', newBankAccount });
    } catch (error) {
        console.error(error);
        if (error.code === 11000) {
            return res.status(200).json({ success: false, message: 'Account number already exists' });
        }
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

router.post('/user/fetch-bank', async (req, res) => {
    const { userId } = req.body;

    const ip = req.headers["x-forwarded-for"]   || req.socket.remoteAddress;
    const clientIp = ip.split(',')[0];
    logMessage(`someone requested ${req.path} from ${clientIp},    ->  ${JSON.stringify({ userId })}`);
    await connectToDatabase();

    try {
        // Find all bank accounts associated with the user ID
        const bankAccounts = await BankAccount.find({ userId });

        if (!bankAccounts.length) {
            return res.status(200).json({ success: true, bankAccounts });
        }

        res.status(200).json({ success: true, bankAccounts });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

module.exports = router;
