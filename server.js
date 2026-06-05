require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { pool } = require("./lib/db");
const cors = require("cors");
const { OAuth2Client } = require("google-auth-library");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const nodemailer = require("nodemailer");
const Imap = require("imap");
const { simpleParser } = require("mailparser");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://certifurb.com", "https://www.certifurb.com"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});
const PORT = process.env.PORT || 5000;

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "your_cloud_name",
  api_key: process.env.CLOUDINARY_API_KEY || "your_api_key",
  api_secret: process.env.CLOUDINARY_API_SECRET || "your_api_secret",
});

// Multer configuration for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
});

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID ||
    "1005786066800-rajkpj63ree8a42grrtm04c1eg4p4qha.apps.googleusercontent.com"
);

app.use(cors({
  origin: ["https://certifurb.com", "https://www.certifurb.com", "http://localhost:3000"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Supabase PostgreSQL (see lib/db.js — uses DATABASE_URL or SUPABASE_URL + SUPABASE_DB_PASSWORD)
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log("✅ Supabase PostgreSQL connected successfully");
    connection.release();
  } catch (error) {
    console.error("❌ Supabase PostgreSQL connection failed:", error.message);
    process.exit(1);
  }
})();

// Define all routes and APIs

// ===== REAL EMAIL CONFIGURATION =====

// Email configuration
const emailAccounts = {
  admin: {
    email: "admin@logisol.tech",
    password: "dp#Wza4SN_*q",
    name: "Admin",
    alternateEmails: ["admin@email.com"],
  },
  sales: {
    email: "sales@logisol.tech",
    password: "ZanfXlBsi3MT",
    name: "Sales",
    alternateEmails: ["sales@email.com"],
  },
  marketing: {
    email: "marketing@logisol.tech",
    password: "E+wsRBbq}vF8",
    name: "Marketer",
    alternateEmails: ["marketer@email.com"],
  },
};

// Function to get email account by user email
const getEmailAccount = (userEmail, userRole) => {
  if (userRole === "admin") {
    // Check if the user email is an admin email (primary or alternate)
    if (
      userEmail === emailAccounts.admin.email ||
      emailAccounts.admin.alternateEmails.includes(userEmail)
    ) {
      return emailAccounts.admin;
    }
  }

  // For non-admin users or if admin email doesn't match
  return Object.values(emailAccounts).find(
    (account) =>
      account.email === userEmail ||
      (account.alternateEmails && account.alternateEmails.includes(userEmail))
  );
};

// Function to create email transporter with specific credentials
const createTransporter = (email, password, name) => {
  try {
    console.log(`Creating transporter for ${email}`);

    if (!password) {
      throw new Error(`Password is required for email account: ${email}`);
    }

    const transporter = nodemailer.createTransport({
      host: "webmail.logisol.tech",
      port: 587,
      secure: false,
      auth: {
        user: email,
        pass: password,
      },
      tls: {
        ciphers: "SSLv3",
        rejectUnauthorized: false,
      },
      debug: true,
      logger: true, // Enable detailed logging
    });

    // Verify transporter
    transporter.verify((error, success) => {
      if (error) {
        console.error("Transporter verification failed:", error);
      } else {
        console.log("Transporter is ready to send emails");
      }
    });

    return transporter;
  } catch (error) {
    console.error("Error creating transporter:", error);
    throw error;
  }
};

// Email provider configurations
const emailProviders = {
  gmail: {
    service: "gmail",
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    imap: {
      host: "imap.gmail.com",
      port: 993,
      tls: true,
    },
  },
  outlook: {
    service: "hotmail",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    imap: {
      host: "outlook.office365.com",
      port: 993,
      tls: true,
    },
  },
  yahoo: {
    service: "yahoo",
    host: "smtp.mail.yahoo.com",
    port: 587,
    secure: false,
    imap: {
      host: "imap.mail.yahoo.com",
      port: 993,
      tls: true,
    },
  },
};

// Email configuration from environment variables
const emailConfig = {
  provider: process.env.EMAIL_PROVIDER || "smtp",
  user: process.env.EMAIL_USER || "your-email@gmail.com",
  password: process.env.EMAIL_PASSWORD || "your-app-password",
  name: process.env.EMAIL_NAME || "Certifurb Admin",
  smtp: {
    host: process.env.SMTP_HOST || "webmail.logisol.tech",
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
  },
};

// Create email transporter
let transporter = null;
try {
  if (emailConfig.user !== "your-email@gmail.com") {
    if (emailConfig.provider === "smtp") {
      transporter = nodemailer.createTransport({
        host: emailConfig.smtp.host,
        port: emailConfig.smtp.port,
        secure: emailConfig.smtp.secure,
        auth: {
          user: emailConfig.user,
          pass: emailConfig.password,
        },
        tls: {
          ciphers: "SSLv3",
          rejectUnauthorized: false,
        },
        debug: true,
      });
    } else {
      const provider = emailProviders[emailConfig.provider];
      if (provider) {
        transporter = nodemailer.createTransport({
          ...provider,
          auth: {
            user: emailConfig.user,
            pass: emailConfig.password,
          },
        });
      }
    }

    console.log(
      `Email service configured for ${emailConfig.provider.toUpperCase()}: ${
        emailConfig.user
      }`
    );
    console.log("Attempting to verify email configuration...");

    // Verify email configuration
    transporter.verify((error, success) => {
      if (error) {
        console.log("Email configuration error details:", {
          message: error.message,
          code: error.code,
          command: error.command,
          response: error.response,
        });
        transporter = null;
      } else {
        console.log("Email server is ready to send emails");
      }
    });
  } else {
    console.log(
      "Email not configured. Please set EMAIL_USER, EMAIL_PASSWORD, and EMAIL_PROVIDER in your .env file"
    );
  }
} catch (error) {
  console.log("Email setup error:", error.message);
  if (error.code) {
    console.log("Error code:", error.code);
  }
  if (error.response) {
    console.log("Server response:", error.response);
  }
}

// IMAP configuration for receiving emails
let imapConfig = null;
if (emailConfig.user !== "your-email@gmail.com") {
  const provider = emailProviders[emailConfig.provider];
  if (provider) {
    imapConfig = {
      user: emailConfig.user,
      password: emailConfig.password,
      host: provider.imap.host,
      port: provider.imap.port,
      tls: provider.imap.tls,
      tlsOptions: { rejectUnauthorized: false },
    };
  }
}

// Function to fetch emails from IMAP
const fetchEmails = () => {
  if (!imapConfig) {
    console.log("IMAP not configured");
    return;
  }

  const imap = new Imap(imapConfig);

  imap.once("ready", () => {
    console.log("IMAP connection ready");
    imap.openBox("INBOX", false, (err, box) => {
      if (err) {
        console.error("Error opening inbox:", err);
        return;
      }

      // Search for unseen emails
      imap.search(["UNSEEN"], (err, results) => {
        if (err) {
          console.error("Error searching emails:", err);
          return;
        }

        if (results.length === 0) {
          console.log("No new emails");
          imap.end();
          return;
        }

        console.log(`Found ${results.length} new emails`);

        // Fetch email details
        const fetch = imap.fetch(results, { bodies: "" });

        fetch.on("message", (msg, seqno) => {
          console.log("Processing email #" + seqno);

          msg.on("body", (stream, info) => {
            simpleParser(stream, async (err, parsed) => {
              if (err) {
                console.error("Error parsing email:", err);
                return;
              }

              try {
                // Save received email to database
                await pool.execute(`
                  INSERT INTO emails 
                  (SenderEmail, RecipientEmail, Subject, Body, HasAttachment, EmailType, IsRead)
                  VALUES (?, ?, ?, ?, ?, ?, 0)
                `, [
                  parsed.from?.text || "unknown@unknown.com",
                  emailConfig.user,
                  parsed.subject || "No Subject",
                  parsed.html || parsed.text || "",
                  parsed.attachments && parsed.attachments.length > 0 ? 1 : 0,
                  "inbox"
                ]);

                console.log(`Saved email: ${parsed.subject}`);

                // Create notification for new email
                try {
                  await pool.execute(`
                    INSERT INTO notifications (type, title, message, isRead, createdAt, updatedAt)
                    VALUES (?, ?, ?, false, NOW(), NOW())
                  `, [
                    'email',
                    'New Email Received',
                    `New email from ${parsed.from?.text || 'Unknown sender'}: ${parsed.subject || 'No subject'}`
                  ]);
                } catch (notificationError) {
                  console.error('Error creating email notification:', notificationError);
                  // Don't fail the main request if notification fails
                }
              } catch (dbError) {
                console.error("Error saving email to database:", dbError);
              }
            });
          });
        });

        fetch.once("end", () => {
          console.log("Done fetching emails");
          imap.end();
        });
      });
    });
  });

  imap.once("error", (err) => {
    console.error("IMAP error:", err);
  });

  imap.connect();
};

// Auto-fetch emails every 5 minutes
if (imapConfig) {
  console.log("Starting email auto-fetch (every 5 minutes)");
  setInterval(fetchEmails, 5 * 60 * 1000); // 5 minutes

  // Fetch emails on startup
  setTimeout(fetchEmails, 5000); // Wait 5 seconds after startup
}

// Manual email fetch endpoint
app.post("/api/cms/emails/fetch", async (req, res) => {
  try {
    if (!imapConfig) {
      return res.status(400).json({
        success: false,
        message:
          "Email receiving not configured. Please set up EMAIL_USER and EMAIL_PASSWORD in .env file.",
      });
    }

    fetchEmails();

    res.json({
      success: true,
      message: "Email fetch initiated. Check inbox in a few moments.",
    });
  } catch (error) {
    console.error("Error initiating email fetch:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching emails",
      error: error.message,
    });
  }
});

// ===== END EMAIL CONFIGURATION =====

// Registration endpoint
app.post("/api/register", async (req, res) => {
  try {
    const { email, password, username, lastname } = req.body;

    if (!email || !password || !username) {
      return res.status(400).json({
        success: false,
        message: "Email, password, and username are required",
      });
    }

    // Check if user already exists
    const [existingUsers] = await pool.execute(
      "SELECT UserID FROM users WHERE UserEmail = ?",
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    // Insert new user with username and lastname
    const [result] = await pool.execute(
      "INSERT INTO users (UserEmail, UserPassword, UserName, UserLastName) VALUES (?, ?, ?, ?)",
      [email, password, username, lastname || null]
    );

    const newUserId = result.insertId;

    // Create notification for new user registration
    try {
      await pool.execute(`
        INSERT INTO notifications (type, title, message, isRead, createdAt, updatedAt)
        VALUES (?, ?, ?, false, NOW(), NOW())
      `, [
        'user',
        'New User Registration',
        `New user registered: ${username} ${lastname || ''} (${email})`
      ]);
    } catch (notificationError) {
      console.error('Error creating notification:', notificationError);
      // Don't fail the main request if notification fails
    }

    res.json({
      success: true,
      message: "Registration Successful",
      data: {
        userId: newUserId,
        email: email,
        username: username,
        lastname: lastname,
      },
    });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({
      success: false,
      message: "Error during registration",
      error: error.message,
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const [rows] = await pool.execute(
      "SELECT UserID, UserEmail, UserName, UserLastName, isAgent FROM users WHERE UserEmail = ? AND UserPassword = ?",
      [email, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "No account found create a new one please",
      });
    }

    const user = rows[0];
    res.json({
      success: true,
      message: "Login Successful",
      data: {
        userId: user.UserID,
        useremail: user.UserEmail,
        username: user.UserName,
        lastname: user.UserLastName,
        isAgent: user.isAgent,
      },
    });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({
      success: false,
      message: "Error during login",
      error: error.message,
    });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM users");
    res.json({
      success: true,
      data: rows,
      message: "Products fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching products",
      error: error.message,
    });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM product");
    res.json({
      success: true,
      data: rows,
      message: "Products fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching products",
      error: error.message,
    });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      "SELECT * FROM product WHERE ProductID = ?",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      data: rows[0],
      message: "Product fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching product",
      error: error.message,
    });
  }
});

app.get("/api/products/search/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const [rows] = await pool.execute(
      "SELECT * FROM product WHERE ProductName LIKE ?",
      [`%${name}%`]
    );

    res.json({
      success: true,
      data: rows,
      message: `Found ${rows.length} products`,
    });
  } catch (error) {
    console.error("Error searching products:", error);
    res.status(500).json({
      success: false,
      message: "Error searching products",
      error: error.message,
    });
  }
});

// Auction Products API endpoint
app.get("/api/auctionproducts", async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM auctionproducts");
    res.json({
      success: true,
      data: rows,
      message: "Auction products fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching auction products:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching auction products",
      error: error.message,
    });
  }
});

// Get single auction product by ID
app.get("/api/auctionproducts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      "SELECT * FROM auctionproducts WHERE productid = ?",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Auction product not found",
      });
    }

    res.json({
      success: true,
      data: rows[0],
      message: "Auction product fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching auction product:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching auction product",
      error: error.message,
    });
  }
});

// Submit bid for auction product
app.post("/api/auctionproducts/:id/bid", async (req, res) => {
  try {
    const { id } = req.params;
    const { bidAmount, userName } = req.body;

    // Validate bid amount
    if (!bidAmount || isNaN(bidAmount) || bidAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid bid amount",
      });
    }

    // Get current auction product
    const [productRows] = await pool.execute(
      "SELECT * FROM auctionproducts WHERE productid = ?",
      [id]
    );

    if (productRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Auction product not found",
      });
    }

    const product = productRows[0];
    
    // Safely parse bids array - handle null, empty, or invalid JSON
    let currentBids = [];
    try {
      if (product.bids && product.bids !== 'null' && product.bids !== '') {
        currentBids = JSON.parse(product.bids);
        if (!Array.isArray(currentBids)) {
          currentBids = [];
        }
      }
    } catch (parseError) {
      console.error('Error parsing bids JSON:', parseError);
      console.error('Raw bids data:', product.bids);
      currentBids = [];
    }
    
    // Check if bid is higher than current highest bid
    // Handle price formatting - remove commas and convert to number
    const currentHighestBid = currentBids.length > 0 
      ? Math.max(...currentBids.map(bid => parseFloat(bid.amount.toString().replace(/,/g, ''))))
      : parseFloat(product.price.toString().replace(/,/g, ''));

    if (bidAmount <= currentHighestBid) {
      return res.status(400).json({
        success: false,
        message: `Bid must be higher than current highest bid of PKR ${currentHighestBid}`,
      });
    }

    // Create new bid object - just bid amount and user name
    const newBid = {
      amount: bidAmount,
      userName: userName
    };

    // Add new bid to bids array
    const updatedBids = [...currentBids, newBid];

    // Update the auction product with new bid
    const [result] = await pool.execute(
      "UPDATE auctionproducts SET bids = ?, price = ? WHERE productid = ?",
      [JSON.stringify(updatedBids), bidAmount, id]
    );

    if (result.affectedRows > 0) {
      res.json({
        success: true,
        message: "Bid placed successfully",
        data: {
          amount: bidAmount,
          userName: userName,
          totalBids: updatedBids.length
        },
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to place bid",
      });
    }
  } catch (error) {
    console.error("Error placing bid:", error);
    res.status(500).json({
      success: false,
      message: "Error placing bid",
      error: error.message,
    });
  }
});

// Add new product endpoint
app.post("/api/products", async (req, res) => {
  try {
    const {
      productName,
      productDesc,
      productPrice,
      productImageURL,
      productCategory,
      productStorage,
      productRam,
      productKeyboard,
      productScreenSize,
      // Technical Specifications
      productModel,
      productGraphics,
      productWeight,
      productCpu,
      productResolution,
      productOs,
      productBattery,
      productBluetooth,
      productWifi,
      productCamera,
      productAudio,
      productBrand,
    } = req.body;

    // Validate required fields
    if (!productName || !productDesc || !productPrice || !productCategory) {
      return res.status(400).json({
        success: false,
        message: "Product name, description, price, and category are required",
      });
    }

    // Generate a unique ProductID (you can modify this logic as needed)
    const timestamp = Date.now().toString();
    const productId = timestamp.slice(-8); // Use last 8 digits of timestamp

    // Insert new product into database
    const [result] = await pool.execute(
      `INSERT INTO product 
        (ProductID, ProductName, ProductDesc, ProductPrice, ProductImageURL, ProductCategory, ProductStorage, ProductRam, ProductKeyboard, ProductScreenSize, ProductModel, ProductGraphics, ProductWeight, ProductCpu, ProductResolution, ProductOs, ProductBattery, ProductBluetooth, ProductWifi, ProductCamera, ProductAudio, ProductBrand) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        productName,
        productDesc,
        parseFloat(productPrice),
        productImageURL || null,
        productCategory || null,
        productStorage || null,
        productRam || null,
        productKeyboard || null,
        productScreenSize || null,
        productModel || null,
        productGraphics || null,
        productWeight || null,
        productCpu || null,
        productResolution || null,
        productOs || null,
        productBattery || null,
        productBluetooth || null,
        productWifi || null,
        productCamera || null,
        productAudio || null,
        productBrand || null,
      ]
    );

    if (result.affectedRows > 0) {
      res.json({
        success: true,
        message: "Product added successfully",
        data: {
          productId: productId,
          productName: productName,
          productDesc: productDesc,
          productPrice: parseFloat(productPrice),
          productImageURL: productImageURL,
          productCategory: productCategory,
          productStorage: productStorage,
          productRam: productRam,
          productKeyboard: productKeyboard,
          productScreenSize: productScreenSize,
          // Technical Specifications
          productModel: productModel,
          productGraphics: productGraphics,
          productWeight: productWeight,
          productCpu: productCpu,
          productResolution: productResolution,
          productOs: productOs,
          productBattery: productBattery,
          productBluetooth: productBluetooth,
          productWifi: productWifi,
          productCamera: productCamera,
          productAudio: productAudio,
          productBrand: productBrand,
        },
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to add product",
      });
    }
  } catch (error) {
    console.error("Error adding product:", error);
    res.status(500).json({
      success: false,
      message: "Error adding product",
      error: error.message,
    });
  }
});

// Update product endpoint
app.put(
  "/api/products/:id",
  upload.single("productImage"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        productName,
        productDesc,
        productPrice,
        productCategory,
        field1,
        field2,
        field3,
        field4,
      } = req.body;

      console.log("Updating product ID:", id);
      console.log("Update data:", req.body);

      // Validate required fields
      if (!productName || !productDesc || !productPrice || !productCategory) {
        return res.status(400).json({
          success: false,
          message:
            "Product name, description, price, and category are required",
        });
      }

      // Check if product exists
      const [existingProducts] = await pool.execute(
        "SELECT * FROM product WHERE ProductID = ?",
        [id]
      );

      if (existingProducts.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      let productImageURL = existingProducts[0].ProductImageURL;

      // Handle image upload if new image is provided
      if (req.file) {
        try {
          const uploadResult = await new Promise((resolve, reject) => {
            cloudinary.uploader
              .upload_stream(
                {
                  folder: "certifurb/products",
                  resource_type: "image",
                },
                (error, result) => {
                  if (error) reject(error);
                  else resolve(result);
                }
              )
              .end(req.file.buffer);
          });

          productImageURL = uploadResult.secure_url;
          console.log("New image uploaded:", productImageURL);
        } catch (uploadError) {
          console.error("Error uploading image:", uploadError);
          return res.status(500).json({
            success: false,
            message: "Error uploading image",
            error: uploadError.message,
          });
        }
      }

      // Update product in database
      const [result] = await pool.execute(
        `UPDATE product 
        SET ProductName = ?,
            ProductDesc = ?,
            ProductPrice = ?,
            ProductImageURL = ?,
            ProductCategory = ?,
            ProductStorage = ?,
            ProductRam = ?,
            ProductScreenSize = ?,
            ProductKeyboard = ?
        WHERE ProductID = ?`,
        [
          productName,
          productDesc,
          parseFloat(productPrice),
          productImageURL,
          productCategory,
          field1 || null,
          field2 || null,
          field3 || null,
          field4 || null,
          id,
        ]
      );

      if (result.affectedRows > 0) {
        res.json({
          success: true,
          message: "Product updated successfully",
          data: {
            productId: id,
            productName: productName,
            productDesc: productDesc,
            productPrice: parseFloat(productPrice),
            productImageURL: productImageURL,
            productCategory: productCategory,
            productStorage: field1,
            productRam: field2,
            productScreenSize: field3,
            productKeyboard: field4,
          },
        });
      } else {
        res.status(500).json({
          success: false,
          message: "Failed to update product",
        });
      }
    } catch (error) {
      console.error("Error updating product:", error);
      res.status(500).json({
        success: false,
        message: "Error updating product",
        error: error.message,
      });
    }
  }
);

// Delete product endpoint
app.delete("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;

    console.log("Deleting product ID:", id);

    // Check if product exists
    const [existingRows] = await pool.execute(
      'SELECT * FROM product WHERE ProductID = ?',
      [id]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Delete product from database
    const [result] = await pool.execute(
      'DELETE FROM product WHERE ProductID = ?',
      [id]
    );

    if (result.affectedRows > 0) {
      res.json({
        success: true,
        message: "Product deleted successfully",
        data: {
          deletedProductId: id,
        },
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to delete product",
      });
    }
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting product",
      error: error.message,
    });
  }
});

// Bulk upload products endpoint
app.post("/api/products/bulk-upload", async (req, res) => {
  try {
    const { products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No products data provided",
      });
    }

    const results = {
      success: true,
      successCount: 0,
      errors: [],
    };

    // Process each product
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const rowNumber = i + 2; // +2 because CSV has header row and array is 0-indexed

      try {
        // Validate required fields
        if (
          !product.productName ||
          !product.productDesc ||
          !product.productPrice ||
          !product.productCategory
        ) {
          results.errors.push({
            row: rowNumber,
            message:
              "Missing required fields: productName, productDesc, productPrice, or productCategory",
          });
          continue;
        }

        // Validate price
        const price = parseFloat(product.productPrice);
        if (isNaN(price) || price <= 0) {
          results.errors.push({
            row: rowNumber,
            message: "Invalid price: must be a positive number",
          });
          continue;
        }

        // Validate category
        const validCategories = [
          "Laptop",
          "Monitor",
          "Desktop PC",
          "Keyboard",
          "Mouse",
          "LCD",
          "LED",
          "Printer",
          "Tablet",
          "Drive",
          "Network",
          "GOAT Product",
        ];
        if (!validCategories.includes(product.productCategory)) {
          results.errors.push({
            row: rowNumber,
            message: `Invalid category: ${
              product.productCategory
            }. Valid categories: ${validCategories.join(", ")}`,
          });
          continue;
        }

        // Generate unique ProductID
        const timestamp = Date.now().toString();
        const productId =
          timestamp.slice(-8) + "-" + i.toString().padStart(3, "0");

        // Insert product into database
        const [result] = await pool.execute(
          `INSERT INTO product 
            (ProductID, ProductName, ProductDesc, ProductPrice, ProductImageURL, ProductCategory, ProductStorage, ProductRam, ProductKeyboard, ProductScreenSize, ProductModel, ProductGraphics, ProductWeight, ProductCpu, ProductResolution, ProductOs, ProductBattery, ProductBluetooth, ProductWifi, ProductCamera, ProductAudio, ProductBrand) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            productId,
            product.productName.trim(),
            product.productDesc.trim(),
            price,
            product.productImageURL || null,
            product.productCategory.trim(),
            product.productStorage?.trim() || null,
            product.productRam?.trim() || null,
            product.productKeyboard?.trim() || null,
            product.productScreenSize?.trim() || null,
            product.productModel?.trim() || null,
            product.productGraphics?.trim() || null,
            product.productWeight?.trim() || null,
            product.productCpu?.trim() || null,
            product.productResolution?.trim() || null,
            product.productOs?.trim() || null,
            product.productBattery?.trim() || null,
            product.productBluetooth?.trim() || null,
            product.productWifi?.trim() || null,
            product.productCamera?.trim() || null,
            product.productAudio?.trim() || null,
            product.productBrand?.trim() || null,
          ]
        );

        if (result.affectedRows > 0) {
          results.successCount++;
        } else {
          results.errors.push({
            row: rowNumber,
            message: "Failed to insert product into database",
          });
        }
      } catch (error) {
        console.error(`Error processing product at row ${rowNumber}:`, error);
        results.errors.push({
          row: rowNumber,
          message: `Database error: ${error.message}`,
        });
      }
    }

    // Set overall success status
    results.success = results.successCount > 0;

    res.json(results);
  } catch (error) {
    console.error("Error in bulk upload:", error);
    res.status(500).json({
      success: false,
      message: "Error processing bulk upload",
      error: error.message,
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// Save Card Information endpoint
app.post("/api/save-card", async (req, res) => {
  try {
    console.log("Received save-card request:", req.body);
    const { userEmail, cardNumber, nameOnCard, expiry, cvv } = req.body;

    // Validate required fields
    if (!userEmail || !cardNumber || !nameOnCard || !expiry || !cvv) {
      console.log("Missing required fields");
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    console.log("Attempting to save card info to database...");

    // Update the specific user's card information using email
    const [result] = await pool.execute(
      `UPDATE users 
        SET UserCardNum = ?, 
            UserNameOnCard = ?, 
            UserCardExpiry = ?, 
            UserCvv = ?
        WHERE UserEmail = ?`,
      [cardNumber, nameOnCard, expiry, cvv, userEmail]
    );

    console.log("Database update result:", result);
    console.log("Rows affected:", result.affectedRows);

    if (result.affectedRows > 0) {
      console.log("Card information saved successfully to database");
      res.json({
        success: true,
        message: "Card information saved successfully!",
      });
    } else {
      console.log("No user found with the provided email");
      res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
  } catch (error) {
    console.error("Error saving card info:", error);
    res.status(500).json({
      success: false,
      message: "Error saving card information",
    });
  }
});

// Get Card Information endpoint
app.get("/api/get-card", async (req, res) => {
  try {
    const { userEmail } = req.query;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: "User email is required",
      });
    }

    // Get the specific user's card information using email
    const [rows] = await pool.execute(
      "SELECT UserCardNum, UserNameOnCard, UserCardExpiry, UserCvv FROM users WHERE UserEmail = ?",
      [userEmail]
    );

    if (rows.length > 0) {
      const user = rows[0];
      res.json({
        success: true,
        data: {
          cardNumber: user.UserCardNum,
          nameOnCard: user.UserNameOnCard,
          expiry: user.UserCardExpiry,
          cvv: user.UserCvv,
        },
      });
    } else {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
  } catch (error) {
    console.error("Error fetching card info:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching card information",
    });
  }
});

// Google Login endpoint
app.post("/api/auth/google", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Google token is required",
      });
    }

    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload.email;
    const fullName = payload.name || "";
    const firstName = payload.given_name || "";
    const lastName = payload.family_name || "";

    // Use given_name as username, fallback to full name or email
    const username = firstName || fullName.split(" ")[0] || email.split("@")[0];

    console.log("Google user data:", {
      email,
      fullName,
      firstName,
      lastName,
      username,
    });

    // Check if user already exists
    const [existingUsers] = await pool.execute(
      "SELECT UserID, UserEmail, UserName, UserLastName FROM users WHERE UserEmail = ?",
      [email]
    );

    let user;
    if (existingUsers.length > 0) {
      // User exists, return existing user data
      user = existingUsers[0];
      console.log("Existing Google user found:", user);
    } else {
      // Create new user with Google data (same structure as normal registration)
      console.log("Creating new Google user...");
      const [result] = await pool.execute(
        "INSERT INTO users (UserEmail, UserPassword, UserName, UserLastName) VALUES (?, ?, ?, ?)",
        [email, "google_oauth", username, lastName || null]
      );

      const newUserId = result.insertId;
      user = {
        UserID: newUserId,
        UserEmail: email,
        UserName: username,
        UserLastName: lastName,
      };
      console.log("New Google user created:", user);
    }

    res.json({
      success: true,
      message: "Google Login Successful",
      data: {
        userId: user.UserID,
        useremail: user.UserEmail,
        username: user.UserName,
        lastname: user.UserLastName,
        loginMethod: "google",
      },
    });
  } catch (error) {
    console.error("Error during Google login:", error);
    res.status(500).json({
      success: false,
      message: "Error during Google authentication",
      error: error.message,
    });
  }
});

// Image Upload Endpoints

// Upload single product image with user/review context
app.post("/api/upload-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
      });
    }

    // Get user and review context from request body
    const { userId, userEmail, reviewId, productId, context, folder } =
      req.body;

    // Determine folder structure
    let cloudinaryFolder;
    let tags;
    let uploadContext;

    if (folder === "products") {
      // Product image upload
      cloudinaryFolder = "certifurb/products";
      tags = ["product", "cms_upload"];
      uploadContext = {
        uploadType: "product_image",
        uploadedBy: "cms",
        ...context,
      };
    } else {
      // User review image upload (existing logic)
      cloudinaryFolder = userId
        ? `certifurb/reviews/user_${userId}`
        : "certifurb/products";
      tags = [
        "review",
        userId ? `user_${userId}` : "anonymous",
        productId ? `product_${productId}` : "general",
        reviewId ? `review_${reviewId}` : "no_review",
      ];
      uploadContext = {
        userId: userId || "anonymous",
        userEmail: userEmail || "anonymous",
        reviewId: reviewId || "none",
        productId: productId || "none",
        uploadType: "review_image",
        ...context,
      };
    }

    // Upload to Cloudinary with appropriate context
    const result = await cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        folder: cloudinaryFolder,
        tags: tags,
        context: uploadContext,
        transformation: [
          { width: 800, height: 800, crop: "limit" },
          { quality: "auto" },
          { fetch_format: "auto" },
        ],
      },
      (error, result) => {
        if (error) {
          console.error("Cloudinary upload error:", error);
          return res.status(500).json({
            success: false,
            message: "Error uploading image to Cloudinary",
            error: error.message,
          });
        }

        res.json({
          success: true,
          message: "Image uploaded successfully",
          data: {
            url: result.secure_url,
            secure_url: result.secure_url, // Include both for compatibility
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            size: result.bytes,
            userId: userId,
            reviewId: reviewId,
            productId: productId,
            tags: result.tags,
            context: result.context,
          },
        });
      }
    );

    const streamifier = require("streamifier");
    streamifier.createReadStream(req.file.buffer).pipe(result);
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).json({
      success: false,
      message: "Error uploading image",
      error: error.message,
    });
  }
});

// Upload multiple review images
app.post("/api/upload-images", upload.array("images", 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No image files provided",
      });
    }

    const { userId, userEmail, reviewId, productId, context } = req.body;
    const folder = userId
      ? `certifurb/reviews/user_${userId}`
      : "certifurb/products";

    const uploadPromises = req.files.map((file) => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            resource_type: "image",
            folder: folder,
            tags: [
              "review",
              userId ? `user_${userId}` : "anonymous",
              productId ? `product_${productId}` : "general",
              reviewId ? `review_${reviewId}` : "no_review",
            ],
            context: {
              userId: userId || "anonymous",
              userEmail: userEmail || "anonymous",
              reviewId: reviewId || "none",
              productId: productId || "none",
              uploadType: "review_image",
              ...context,
            },
            transformation: [
              { width: 800, height: 800, crop: "limit" },
              { quality: "auto" },
              { fetch_format: "auto" },
            ],
          },
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve({
                url: result.secure_url,
                publicId: result.public_id,
                width: result.width,
                height: result.height,
                format: result.format,
                size: result.bytes,
                userId: userId,
                reviewId: reviewId,
                productId: productId,
              });
            }
          }
        );

        const streamifier = require("streamifier");
        streamifier.createReadStream(file.buffer).pipe(uploadStream);
      });
    });

    const uploadResults = await Promise.all(uploadPromises);

    res.json({
      success: true,
      message: `${uploadResults.length} images uploaded successfully`,
      data: uploadResults,
    });
  } catch (error) {
    console.error("Error uploading images:", error);
    res.status(500).json({
      success: false,
      message: "Error uploading images",
      error: error.message,
    });
  }
});

// Save review with images to database
app.post("/api/save-review", async (req, res) => {
  try {
    const {
      userEmail,
      productId,
      reviewText,
      rating,
      imageUrls, // Array of Cloudinary URLs
    } = req.body;

    if (!userEmail || !productId || !reviewText) {
      return res.status(400).json({
        success: false,
        message: "UserEmail, productId, and reviewText are required",
      });
    }

    // Convert image URLs array to JSON string for storage
    const imageUrlsJson = imageUrls ? JSON.stringify(imageUrls) : null;

    const [result] = await pool.execute(`
      INSERT INTO Reviews 
      (UserEmail, ProductID, ReviewText, Rating, ImageUrls, CreatedAt) 
      VALUES (?, ?, ?, ?, ?, ?)
    `, [userEmail, productId, reviewText, rating || null, imageUrlsJson, new Date()]);

    const reviewId = result.insertId;

    res.json({
      success: true,
      message: "Review saved successfully",
      data: {
        reviewId: reviewId,
        userEmail: userEmail,
        productId: productId,
        reviewText: reviewText,
        rating: rating,
        imageUrls: imageUrls,
        createdAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Error saving review:", error);
    res.status(500).json({
      success: false,
      message: "Error saving review",
      error: error.message,
    });
  }
});

// Get reviews for a specific product
app.get("/api/reviews/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;

    const [rows] = await pool.execute(`
      SELECT r.*, u.UserName 
      FROM Reviews r
      LEFT JOIN Users u ON r.UserEmail = u.UserEmail
      WHERE r.ProductID = ?
      ORDER BY r.CreatedAt DESC
    `, [productId]);

    const reviews = rows.map((review) => ({
      reviewId: review.ReviewID,
      userEmail: review.UserEmail,
      userName: review.UserName,
      productId: review.ProductID,
      reviewText: review.ReviewText,
      rating: review.Rating,
      imageUrls: review.ImageUrls ? JSON.parse(review.ImageUrls) : [],
      createdAt: review.CreatedAt,
    }));

    res.json({
      success: true,
      message: `Found ${reviews.length} reviews for product ${productId}`,
      data: reviews,
    });
  } catch (error) {
    console.error("Error fetching product reviews:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching product reviews",
      error: error.message,
    });
  }
});

// Get reviews by specific user
app.get("/api/reviews/user/:userEmail", async (req, res) => {
  try {
    const { userEmail } = req.params;

    const [rows] = await pool.execute(`
      SELECT r.*, u.UserName, p.ProductName
      FROM Reviews r
      LEFT JOIN Users u ON r.UserEmail = u.UserEmail
      LEFT JOIN Product p ON r.ProductID = p.ProductID
      WHERE r.UserEmail = ?
      ORDER BY r.CreatedAt DESC
    `, [userEmail]);

    const reviews = rows.map((review) => ({
      reviewId: review.ReviewID,
      userEmail: review.UserEmail,
      userName: review.UserName,
      productId: review.ProductID,
      productName: review.ProductName,
      reviewText: review.ReviewText,
      rating: review.Rating,
      imageUrls: review.ImageUrls ? JSON.parse(review.ImageUrls) : [],
      createdAt: review.CreatedAt,
    }));

    res.json({
      success: true,
      message: `Found ${reviews.length} reviews by user ${userEmail}`,
      data: reviews,
    });
  } catch (error) {
    console.error("Error fetching user reviews:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user reviews",
      error: error.message,
    });
  }
});

// Get images by user ID
app.get("/api/images/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 10, next_cursor } = req.query;

    const options = {
      expression: `tags:user_${userId}`,
      max_results: parseInt(limit),
      resource_type: "image",
    };

    if (next_cursor) {
      options.next_cursor = next_cursor;
    }

    const result = await cloudinary.search.execute(options);

    const images = result.resources.map((resource) => ({
      publicId: resource.public_id,
      url: resource.secure_url,
      width: resource.width,
      height: resource.height,
      format: resource.format,
      size: resource.bytes,
      createdAt: resource.created_at,
      tags: resource.tags || [],
      context: resource.context || {},
    }));

    res.json({
      success: true,
      message: `Found ${images.length} images for user ${userId}`,
      data: {
        images,
        hasMore: !!result.next_cursor,
        nextCursor: result.next_cursor || null,
        userId,
      },
    });
  } catch (error) {
    console.error("Error fetching user images:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user images",
      error: error.message,
    });
  }
});

// Save user review to database (using your database structure)
app.post("/api/save-user-review", async (req, res) => {
  try {
    const { userEmail, reviewText, rating, imageUrls } = req.body;

    if (!userEmail || !reviewText) {
      return res.status(400).json({
        success: false,
        message: "UserEmail and reviewText are required",
      });
    }

    // Convert image URLs array to JSON string for storage
    const imageUrlsJson =
      imageUrls && imageUrls.length > 0 ? JSON.stringify(imageUrls) : null;

    // Update the user's review and image URL in the users table
    const [result] = await pool.execute(`
      UPDATE users 
      SET UserReview = ?, 
          UserImageURL = ?
      WHERE UserEmail = ?
    `, [reviewText, imageUrlsJson, userEmail]);

    if (result.affectedRows > 0) {
      res.json({
        success: true,
        message: "Review saved successfully",
        data: {
          userEmail: userEmail,
          reviewText: reviewText,
          imageUrls: imageUrls,
          savedAt: new Date(),
        },
      });
    } else {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
  } catch (error) {
    console.error("Error saving user review:", error);
    res.status(500).json({
      success: false,
      message: "Error saving review",
      error: error.message,
    });
  }
});

// Get user's purchased products (orders) for reviews
app.get("/api/user-orders/:userEmail", async (req, res) => {
  try {
    const { userEmail } = req.params;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: "User email is required",
      });
    }

    const [rows] = await pool.execute(`
      SELECT DISTINCT
        o.ProductID,
        p.ProductName,
        p.ProductPrice,
        p.ProductImageURL,
        o.OrderDate,
        o.Quantity,
        o.TotalPrice,
        CASE WHEN ur.ReviewID IS NOT NULL THEN 1 ELSE 0 END as HasReview
      FROM orders o
      INNER JOIN product p ON o.ProductID = p.ProductID
      LEFT JOIN userreviews ur ON ur.UserEmail = o.UserEmail AND ur.ProductID = o.ProductID
      WHERE o.UserEmail = ?
      ORDER BY o.OrderDate DESC
    `, [userEmail]);

    res.json({
      success: true,
      data: rows,
      message: "User orders fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching user orders:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user orders",
      error: error.message,
    });
  }
});

// Save product-specific review endpoint
app.post("/api/save-product-review", async (req, res) => {
  try {
    const { userEmail, productId, reviewText, rating, imageUrls } = req.body;

    if (!userEmail || !productId || !reviewText) {
      return res.status(400).json({
        success: false,
        message: "User email, product ID, and review text are required",
      });
    }

    // Check if user has purchased this product
    const [purchaseRows] = await pool.execute(
      `SELECT COUNT(*) as PurchaseCount 
        FROM orders o
        INNER JOIN users u ON o.UserEmail = u.UserEmail
        WHERE u.UserEmail = ? AND o.ProductID = ?`,
      [userEmail, productId]
    );

    if (purchaseRows[0].PurchaseCount === 0) {
      return res.status(403).json({
        success: false,
        message: "You can only review products you have purchased",
      });
    }

    // Check if review already exists
    const [existingReviews] = await pool.execute(
      "SELECT ReviewID FROM userreviews WHERE UserEmail = ? AND ProductID = ?",
      [userEmail, productId]
    );

    if (existingReviews.length > 0) {
      // Update existing review
      await pool.execute(
        `UPDATE userreviews 
          SET ReviewText = ?, Rating = ?, ImageUrls = ?, UpdatedAt = NOW()
          WHERE UserEmail = ? AND ProductID = ?`,
        [
          reviewText,
          rating || 5,
          JSON.stringify(imageUrls || []),
          userEmail,
          productId,
        ]
      );

      res.json({
        success: true,
        message: "Review updated successfully!",
        data: { isUpdate: true },
      });
    } else {
      // Insert new review
      await pool.execute(
        `INSERT INTO userreviews (UserEmail, ProductID, ReviewText, Rating, ImageUrls, CreatedAt)
          VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          userEmail,
          productId,
          reviewText,
          rating || 5,
          JSON.stringify(imageUrls || []),
        ]
      );

      res.json({
        success: true,
        message: "Review submitted successfully!",
        data: { isUpdate: false },
      });
    }
  } catch (error) {
    console.error("Error saving product review:", error);
    res.status(500).json({
      success: false,
      message: "Error saving review",
      error: error.message,
    });
  }
});

// Get user's reviews for products
app.get("/api/user-product-reviews/:userEmail", async (req, res) => {
  try {
    const { userEmail } = req.params;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: "User email is required",
      });
    }

    const [rows] = await pool.execute(
      `SELECT 
          ur.ReviewID,
          ur.ProductID,
          ur.ReviewText,
          ur.Rating,
          ur.ImageUrls,
          ur.CreatedAt,
          p.ProductName,
          p.ProductPrice,
          p.ProductImageURL
        FROM userreviews ur
        INNER JOIN product p ON ur.ProductID = p.ProductID
        WHERE ur.UserEmail = ?
        ORDER BY ur.CreatedAt DESC`,
      [userEmail]
    );

    res.json({
      success: true,
      data: rows,
      message: "User reviews fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching user reviews:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user reviews",
      error: error.message,
    });
  }
});

// Get all users with reviews (for product page display)
app.get("/api/all-user-reviews", async (req, res) => {
  try {
    const { productId } = req.query;

    let query = `
        SELECT 
          ur.ReviewID,
          ur.ProductID,
          ur.ReviewText,
          ur.Rating,
          ur.ImageUrls,
          ur.CreatedAt,
          u.UserName,
          p.ProductName
        FROM userreviews ur
        INNER JOIN users u ON ur.UserEmail = u.UserEmail
        INNER JOIN product p ON ur.ProductID = p.ProductID
      `;

    let queryParams = [];

    // If productId is provided, filter by that product
    if (productId) {
      query += ` WHERE ur.ProductID = ?`;
      queryParams.push(productId);
    }

    query += ` ORDER BY ur.CreatedAt DESC`;

    const [rows] = await pool.execute(query, queryParams);

    const reviews = rows.map((review) => ({
      reviewId: review.ReviewID,
      productId: review.ProductID,
      productName: review.ProductName,
      userName: review.UserName,
      reviewText: review.ReviewText,
      rating: review.Rating,
      imageUrls: review.ImageUrls ? JSON.parse(review.ImageUrls) : [],
      createdAt: review.CreatedAt,
    }));

    res.json({
      success: true,
      message: `Found ${reviews.length} user reviews`,
      data: reviews,
    });
  } catch (error) {
    console.error("Error fetching all user reviews:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user reviews",
      error: error.message,
    });
  }
});

// Create UserReviews table if it doesn't exist
app.post("/api/create-reviews-table", async (req, res) => {
  try {
    // Table is created by database/supabase_schema.sql
    await pool.execute(`SELECT 1 FROM userreviews LIMIT 1`);

    res.json({
      success: true,
      message: "UserReviews table created successfully (if it did not exist)",
    });
  } catch (error) {
    console.error("Error creating UserReviews table:", error);
    res.status(500).json({
      success: false,
      message: "Error creating UserReviews table",
      error: error.message,
    });
  }
});
// Test endpoint to verify new code is loading
app.get("/api/test-new-endpoint", (req, res) => {
  res.json({
    success: true,
    message: "New endpoint is working! Server code has been updated.",
    timestamp: new Date().toISOString(),
  });
});

// Daily.co API endpoint - Create room for video calls
app.post("/api/daily/create-room", async (req, res) => {
  try {
    const { sessionId, userEmail, targetUserEmail } = req.body;
    console.log('🏠 Creating Daily.co room request:', { sessionId, userEmail, targetUserEmail });

    if (!sessionId || !userEmail || !targetUserEmail) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields: sessionId, userEmail, targetUserEmail' 
      });
    }

    // Daily.co API key from environment variables
    const DAILY_API_KEY = process.env.DAILY_API_KEY;
    
    if (!DAILY_API_KEY) {
      console.error('❌ DAILY_API_KEY not found in environment variables');
      return res.status(500).json({ 
        success: false,
        message: 'Daily.co API key not configured' 
      });
    }

    // Create room name based on session ID
    const roomName = `livestore-${sessionId}`;

    console.log('🏠 Creating Daily.co room:', { roomName, sessionId, userEmail, targetUserEmail });

    // Create room via Daily.co API
    const response = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DAILY_API_KEY}`,
      },
      body: JSON.stringify({
        name: roomName,
        properties: {
          max_participants: 2, // Only user and agent
          enable_chat: false,
          enable_screenshare: true,
          enable_recording: false,
          exp: Math.floor(Date.now() / 1000) + 3600, // Expire in 1 hour
        },
      }),
    });

    const responseText = await response.text();
    console.log('🏠 Daily.co API response:', { status: response.status, body: responseText });

    if (!response.ok) {
      let errorData;
      try {
        errorData = JSON.parse(responseText);
      } catch (e) {
        errorData = { message: responseText };
      }
      console.error('❌ Daily.co API error:', errorData);
      return res.status(response.status).json({ 
        success: false,
        message: 'Failed to create room', 
        error: errorData 
      });
    }

    const roomData = JSON.parse(responseText);
    console.log('✅ Room created successfully:', roomData);

    // Return room information
    return res.status(200).json({
      success: true,
      sessionId,
      name: roomData.name,
      url: roomData.url,
      participants: {
        user: userEmail,
        agent: targetUserEmail,
      },
      expires: roomData.config?.exp || null,
    });

  } catch (error) {
    console.error('❌ Error creating Daily.co room:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// Save order endpoint
app.post("/api/save-order", async (req, res) => {
  try {
    console.log("Save order endpoint hit");
    console.log("Request body:", req.body);

    const { orders } = req.body;

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Orders array is required",
      });
    }

    console.log("Saving orders:", orders);

    // Insert each order into the database
    for (const order of orders) {
      const { userEmail, productId, quantity, totalPrice, customerInfo } =
        order;

      if (!userEmail || !productId || !quantity || !totalPrice) {
        return res.status(400).json({
          success: false,
          message:
            "Missing required order fields: userEmail, productId, quantity, totalPrice",
        });
      }

      await pool.execute(
        'INSERT INTO orders (UserEmail, ProductID, OrderDate, Quantity, TotalPrice) VALUES (?, ?, NOW(), ?, ?)',
        [userEmail, productId, quantity, totalPrice]
      );
    }

    res.json({
      success: true,
      message: `${orders.length} order(s) saved successfully`,
      data: { orderCount: orders.length },
    });
  } catch (error) {
    console.error("Error saving orders:", error);
    res.status(500).json({
      success: false,
      message: "Error saving orders",
      error: error.message,
    });
  }
});

// CMS Login endpoint - checks for admin users
app.post("/api/cms/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const [rows] = await pool.execute(
      'SELECT UserID, UserEmail, UserName, UserLastName, UserRole FROM users WHERE UserEmail = ? AND UserPassword = ?',
      [email, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const user = rows[0];
    // Set default role to 'user' if not specified
    const userRole = user.UserRole || "user";

    // Check if user has CMS access (admin, marketer, or sales)
    if (
      userRole !== "admin" &&
      userRole !== "marketer" &&
      userRole !== "sales"
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. CMS privileges required.",
      });
    }

    // Log successful login
    console.log(`Successful CMS login for ${email} with role: ${userRole}`);

    res.json({
      success: true,
      message: "CMS Login Successful",
      data: {
        userId: user.UserID,
        useremail: user.UserEmail,
        username: user.UserName,
        lastname: user.UserLastName,
        role: userRole,
        isAdmin: userRole === "admin",
        isMarketer: userRole === "marketer",
        isSales: userRole === "sales",
      },
    });
  } catch (error) {
    console.error("Error during CMS login:", error);
    res.status(500).json({
      success: false,
      message: "Error during login",
      error: error.message,
    });
  }
});

// CMS Users endpoint - get all users (admin only)
app.get("/api/cms/users", async (req, res) => {
  try {
    // In a production app, you'd verify the admin token here
    // For now, we'll trust that the frontend is handling admin verification

    const [rows] = await pool.execute(
      "SELECT UserID, UserEmail, UserName, UserLastName FROM users ORDER BY UserID DESC"
    );

    res.json({
      success: true,
      data: rows,
      message: `Found ${rows.length} users`,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching users",
      error: error.message,
    });
  }
});

// Setup role system - add UserRole column and set default roles
app.post("/api/setup-roles", async (req, res) => {
  try {
    await pool
      .execute(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS "UserRole" VARCHAR(50) DEFAULT 'user'`
      )
      .catch(() => {
        console.log("UserRole column may already exist");
      });

    // Set specific roles for known users
    await pool.execute(`
        UPDATE users 
        SET UserRole = CASE 
          WHEN UserEmail LIKE '%admin%' OR UserEmail IN ('admin@email.com', 'admin@certifurb.com') THEN 'admin'
          WHEN UserEmail = 'marketer@email.com' THEN 'marketer'
          WHEN UserEmail = 'sales@email.com' OR UserEmail = 'sales@logisol.tech' THEN 'sales'
          WHEN UserEmail = 'marketer@email.com' OR UserEmail = 'marketing@logisol.tech' THEN 'marketer'
          ELSE 'user'
        END
      `);

    // Verify roles were set correctly
    const [roleRows] = await pool.execute(`
        SELECT UserEmail, UserRole 
        FROM users 
        WHERE UserRole IN ('admin', 'sales', 'marketer')
      `);

    console.log("Updated user roles:", roleRows);

    res.json({
      success: true,
      message:
        "Role system setup complete! Admin, sales and marketer roles assigned.",
      data: roleRows,
    });
  } catch (error) {
    console.error("Error setting up roles:", error);
    res.status(500).json({
      success: false,
      message: "Error setting up role system",
      error: error.message,
    });
  }
});

// Get all orders for CMS admin
app.get("/api/cms/orders", async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const offset = (page - 1) * limit;

    // Base query
    let whereClause = "";
    let searchParams = [];

    // Add search functionality (safe search without Product table dependency)
    if (search) {
      console.log('Search term:', search);
      whereClause += ` WHERE (o.UserEmail LIKE ? OR CAST(o.OrderID AS CHAR) LIKE ? OR u.UserName LIKE ? OR u.UserLastName LIKE ?)`;
      searchParams = [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`];
      console.log('Where clause:', whereClause);
      console.log('Search params:', searchParams);
    }

    // Try to get orders with product info - let's test different table names
    let result;
    try {
      // First try with [dbo].[Product] (singular) - ensuring proper join
      console.log("Trying to fetch orders with product details...");

      // Quick test: Can we access product table at all?
      const [productTestRows] = await pool.execute('SELECT COUNT(*) as ProductCount FROM product');
      console.log(
        "Product table accessibility test - Total products:",
        productTestRows[0].ProductCount
      );
      const [resultRows] = await pool.execute(`
        SELECT 
          o.OrderID,
          o.UserEmail,
          o.ProductID,
          o.OrderDate,
          o.Quantity,
          o.TotalPrice,
          p.ProductName,
          p.ProductPrice,
          p.ProductImageURL,
          u.UserName,
          u.UserLastName
        FROM orders o
        LEFT JOIN product p ON CAST(o.ProductID AS CHAR) = CAST(p.ProductID AS CHAR)
        LEFT JOIN users u ON o.UserEmail = u.UserEmail
        ${whereClause}
        ORDER BY o.OrderDate DESC
        LIMIT ${limit} OFFSET ${offset}
      `, searchParams);
      result = { recordset: resultRows };
      console.log("✅ Successfully fetched orders with product details");
      console.log(
        "First order after JOIN:",
        result.recordset[0] ? result.recordset[0] : "No orders found"
      );
    } catch (productsError) {
      console.log(
        "Product table access failed, trying alternative:",
        productsError.message
      );
      // Fallback: try without schema prefix
      try {
        const [resultRows] = await pool.execute(`
          SELECT 
            o.OrderID,
            o.UserEmail,
            o.ProductID,
            o.OrderDate,
            o.Quantity,
            o.TotalPrice,
            p.ProductName,
            p.ProductPrice,
            p.ProductImageURL,
            u.UserName,
            u.UserLastName
          FROM orders o
          LEFT JOIN product p ON CAST(o.ProductID AS CHAR) = CAST(p.ProductID AS CHAR)
          LEFT JOIN users u ON o.UserEmail = u.UserEmail
          ${whereClause}
          ORDER BY o.OrderDate DESC
          LIMIT ${limit} OFFSET ${offset}
        `, searchParams);
        result = { recordset: resultRows };
      } catch (alternativeError) {
        console.log(
          "Alternative Product query failed, using orders only:",
          alternativeError.message
        );
        // Final fallback: orders only
        const [fallbackRows] = await pool.execute(`
          SELECT 
            o.OrderID,
            o.UserEmail,
            o.ProductID,
            o.OrderDate,
            o.Quantity,
            o.TotalPrice,
            u.UserName,
            u.UserLastName
          FROM orders o
          LEFT JOIN users u ON o.UserEmail = u.UserEmail
          ${whereClause}
          ORDER BY o.OrderDate DESC
          LIMIT ${limit} OFFSET ${offset}
        `, searchParams);
        result = { recordset: fallbackRows };
      }
    }

    // Get total count for pagination
    let countResult;
    try {
      const [countRows] = await pool.execute(`
        SELECT COUNT(*) as total
        FROM orders o
        LEFT JOIN product p ON CAST(o.ProductID AS CHAR) = CAST(p.ProductID AS CHAR)
        LEFT JOIN users u ON o.UserEmail = u.UserEmail
        ${whereClause}
      `, searchParams);
      countResult = { recordset: countRows };
    } catch (error) {
      // Fallback without products table
      const [fallbackCountRows] = await pool.execute(`
        SELECT COUNT(*) as total
        FROM orders o
        LEFT JOIN users u ON o.UserEmail = u.UserEmail
        ${whereClause}
      `, searchParams);
      countResult = { recordset: fallbackCountRows };
    }

    const total = countResult.recordset[0].total;
    const totalPages = Math.ceil(total / limit);

    // Debug: Log the raw data we got from database
    console.log("Raw order data from database:");
    console.log(result.recordset.slice(0, 2)); // Log first 2 orders for debugging

    // Debug: Check if ProductName is coming through
    const sampleOrder = result.recordset[0];
    if (sampleOrder) {
      console.log("Sample order ProductName:", sampleOrder.ProductName);
      console.log("Sample order ProductID:", sampleOrder.ProductID);
      console.log("Sample order ProductID type:", typeof sampleOrder.ProductID);
      console.log("All keys in sample order:", Object.keys(sampleOrder));

      // Let's check what products exist in the Product table
      console.log("Checking Product table for matching ProductID...");
      try {
        const [productRows] = await pool.execute(
          'SELECT ProductID, ProductName FROM product WHERE ProductID = ?',
          [sampleOrder.ProductID]
        );
        console.log("Direct product lookup result:", productRows);

        // Also check first few products in product table
        const [allProductRows] = await pool.execute('SELECT ProductID, ProductName FROM product LIMIT 5');
        console.log("Sample products in Product table:", allProductRows);
      } catch (productError) {
        console.log("Error checking Product table:", productError.message);
      }
    }

    // If ProductName is missing, fetch it manually
    const ordersWithProducts = await Promise.all(
      result.recordset.map(async (order) => {
        if (!order.ProductName && order.ProductID) {
          try {
            const [productRows] = await pool.execute(
              'SELECT ProductName, ProductPrice, ProductImageURL FROM product WHERE ProductID = ?',
              [order.ProductID]
            );

            if (productRows.length > 0) {
              const product = productRows[0];
              return {
                ...order,
                ProductName: product.ProductName,
                ProductPrice: product.ProductPrice,
                ProductImageURL: product.ProductImageURL,
              };
            }
          } catch (error) {
            console.log(
              "Error fetching product for ID:",
              order.ProductID,
              error.message
            );
          }
        }
        return order;
      })
    );

    // Debug: Log sample order data
    console.log("Sample order before formatting:", ordersWithProducts[0]);
    
    // Format the orders for frontend
    const formattedOrders = ordersWithProducts.map((order) => ({
      id: order.OrderID,
      orderNumber: `#${order.OrderID}`,
      total: `PKR ${order.TotalPrice}`,
      customer: {
        id: order.UserEmail, // Use email as identifier
        name:
          order.UserName && order.UserLastName
            ? `${order.UserName} ${order.UserLastName}`
            : order.UserEmail,
        email: order.UserEmail,
        avatar: "/api/placeholder/32/32",
      },
      product: {
        name: order.ProductName
          ? `${order.ProductName} (ID: ${order.ProductID})`
          : `Product ID: ${order.ProductID}`,
        id: order.ProductID,
        price: order.ProductPrice,
        image: order.ProductImageURL,
      },
      quantity: order.Quantity,
      paymentStatus: {
        text: "PAID",
        color: "bg-green-100 text-green-800",
      },
      fulfillmentStatus: {
        text: "ORDER FULFILLED",
        color: "bg-green-100 text-green-800",
      },
      deliveryType: "Standard shipping",
      date: new Date(order.OrderDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      rawDate: order.OrderDate,
    }));

    res.json({
      success: true,
      data: {
        orders: formattedOrders,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      },
      message: `Found ${formattedOrders.length} orders`,
    });
  } catch (error) {
    console.error("Error fetching CMS orders:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching orders",
      error: error.message,
    });
  }
});

// Get order details for CMS admin
app.get("/api/cms/orders/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    let result;
    try {
      const [resultRows] = await pool.execute(`
        SELECT 
          o.OrderID,
          o.UserEmail,
          o.ProductID,
          o.OrderDate,
          o.Quantity,
          o.TotalPrice,
          p.ProductName,
          p.ProductPrice,
          p.ProductImageURL,
          p.ProductDesc,
          u.UserName,
          u.UserLastName,
          u.UserEmail as CustomerEmail
        FROM orders o
        LEFT JOIN product p ON CAST(o.ProductID AS CHAR) = CAST(p.ProductID AS CHAR)
        LEFT JOIN users u ON o.UserEmail = u.UserEmail
        WHERE o.OrderID = ?
      `, [orderId]);
      result = { recordset: resultRows };
    } catch (error) {
      // Fallback without products table
      const [fallbackRows] = await pool.execute(`
        SELECT 
          o.OrderID,
          o.UserEmail,
          o.UserID,
          o.ProductID,
          o.OrderDate,
          o.Quantity,
          o.TotalPrice,
          u.UserName,
          u.UserLastName,
          u.UserEmail as CustomerEmail
        FROM orders o
        LEFT JOIN users u ON o.UserEmail = u.UserEmail
        WHERE o.OrderID = ?
      `, [orderId]);
      result = { recordset: fallbackRows };
    }

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = result.recordset[0];

    res.json({
      success: true,
      data: {
        orderId: order.OrderID,
        orderNumber: `#${order.OrderID}`,
        customer: {
          name:
            order.UserName && order.UserLastName
              ? `${order.UserName} ${order.UserLastName}`
              : order.UserEmail,
          email: order.CustomerEmail,
        },
        product: {
          id: order.ProductID,
          name: order.ProductName
            ? `${order.ProductName} (ID: ${order.ProductID})`
            : `Product ID: ${order.ProductID}`,
          price: order.ProductPrice,
          description: order.ProductDesc || "Product details not available",
          images: order.ProductImageURL,
        },
        quantity: order.Quantity,
        totalPrice: order.TotalPrice,
        orderDate: order.OrderDate,
        status: "completed",
      },
      message: "Order details fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching order details",
      error: error.message,
    });
  }
});

// Track order by order ID for customers (requires user authentication)
app.post("/api/track-order", async (req, res) => {
  try {
    const { orderId, userEmail } = req.body;

    if (!orderId || !userEmail) {
      return res.status(400).json({
        success: false,
        message: "Order ID and user email are required",
      });
    }

    console.log(`Tracking order ID: ${orderId} for user: ${userEmail}`);

    // Check if the order exists AND belongs to the requesting user
    const [orderRows] = await pool.execute(`
      SELECT 
        o.OrderID,
        o.UserEmail,
        o.ProductID,
        o.OrderDate,
        o.Quantity,
        o.TotalPrice,
        u.UserName,
        u.UserLastName,
        p.ProductName,
        p.ProductImageURL,
        p.ProductPrice
      FROM orders o
      LEFT JOIN users u ON o.UserEmail = u.UserEmail
      LEFT JOIN product p ON CAST(o.ProductID AS CHAR) = CAST(p.ProductID AS CHAR)
      WHERE o.OrderID = ? AND o.UserEmail = ?
    `, [orderId, userEmail]);

    if (orderRows.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Order not found or you do not have permission to view this order",
      });
    }

    const order = orderRows[0];
    console.log("Order found:", order);

    // Try to get shipment data, but handle if Shipments table doesn't exist
    let shipmentData = {
      ShipmentStatus: "Order Placed",
      TrackingNumber: "",
      EstimatedDelivery: null,
      ShippingAddress: "",
      CourierService: "Standard Delivery",
      StatusUpdatedAt: null,
      ShipmentNotes: "",
    };

    try {
              const [shipmentRows] = await pool.execute(`
          SELECT 
            ShipmentStatus,
            TrackingNumber,
            EstimatedDelivery,
            ShippingAddress,
            CourierService,
            StatusUpdatedAt,
            ShipmentNotes
          FROM shipments
          WHERE OrderID = ?
        `, [orderId]);

      if (shipmentRows.length > 0) {
        shipmentData = shipmentRows[0];
      }
    } catch (shipmentError) {
      console.log(
        "Shipments table might not exist, using default values:",
        shipmentError.message
      );
    }

    // Define shipment status progression
    const statusSteps = [
      {
        key: "Order Placed",
        label: "Order Placed",
        description: "Your order has been received and is being processed",
      },
      {
        key: "Processing",
        label: "Processing",
        description: "Your order is being prepared for shipment",
      },
      {
        key: "Shipped",
        label: "Shipped",
        description: "Your order has been shipped and is on its way",
      },
      {
        key: "Out for Delivery",
        label: "Out for Delivery",
        description: "Your order is out for delivery",
      },
      {
        key: "Delivered",
        label: "Delivered",
        description: "Your order has been delivered successfully",
      },
    ];

    const currentStatusIndex = statusSteps.findIndex(
      (step) => step.key === shipmentData.ShipmentStatus
    );

    const trackingData = {
      orderId: order.OrderID,
      orderNumber: `#${order.OrderID}`,
      orderDate: new Date(order.OrderDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      customer: {
        name:
          order.UserName && order.UserLastName
            ? `${order.UserName} ${order.UserLastName}`
            : order.UserEmail,
        email: order.UserEmail,
      },
      product: {
        name: order.ProductName || `Product ID: ${order.ProductID}`,
        image: order.ProductImageURL,
        price: `PKR ${order.ProductPrice}`,
        quantity: order.Quantity,
      },
      total: `PKR ${order.TotalPrice}`,
      shipment: {
        status: shipmentData.ShipmentStatus,
        trackingNumber: shipmentData.TrackingNumber,
        estimatedDelivery: shipmentData.EstimatedDelivery
          ? new Date(shipmentData.EstimatedDelivery).toLocaleDateString(
              "en-US",
              {
                year: "numeric",
                month: "long",
                day: "numeric",
              }
            )
          : null,
        shippingAddress: shipmentData.ShippingAddress,
        courierService: shipmentData.CourierService,
        lastUpdated: shipmentData.StatusUpdatedAt
          ? new Date(shipmentData.StatusUpdatedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })
          : null,
        notes: shipmentData.ShipmentNotes,
      },
      statusSteps: statusSteps.map((step, index) => ({
        ...step,
        completed: index <= currentStatusIndex,
        current: index === currentStatusIndex,
      })),
    };

    res.json({
      success: true,
      data: trackingData,
      message: "Order tracking information retrieved successfully",
    });
  } catch (error) {
    console.error("Error tracking order:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving tracking information",
      error: error.message,
    });
  }
});

// Get all shipments for CMS admin
app.get("/api/cms/shipments", async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status } = req.query;
    const offset = (page - 1) * limit;

    console.log("Fetching shipments for CMS...");

    // First get all orders
    let whereClause = "";
    let searchConditions = [];

    if (search) {
      searchConditions.push(
        `(o.OrderID LIKE '%${search}%' OR u.UserEmail LIKE '%${search}%' OR u.UserName LIKE '%${search}%')`
      );
    }

    if (searchConditions.length > 0) {
      whereClause = ` WHERE ${searchConditions.join(" AND ")}`;
    }

    const [resultRows] = await pool.execute(`
      SELECT 
        o.OrderID,
        o.UserEmail,
        o.ProductID,
        o.OrderDate,
        o.Quantity,
        o.TotalPrice,
        u.UserName,
        u.UserLastName,
        p.ProductName,
        p.ProductImageURL
      FROM orders o
      LEFT JOIN users u ON o.UserEmail = u.UserEmail
      LEFT JOIN product p ON CAST(o.ProductID AS CHAR) = CAST(p.ProductID AS CHAR)
      ${whereClause}
      ORDER BY o.OrderDate DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // Try to get shipment data for each order
    const ordersWithShipments = [];
    for (const order of resultRows) {
      let shipmentData = {
        ShipmentStatus: "Order Placed",
        TrackingNumber: "",
        EstimatedDelivery: null,
        ShippingAddress: "",
        CourierService: "Standard Delivery",
        StatusUpdatedAt: null,
        ShipmentNotes: "",
      };

      try {
        const [shipmentRows] = await pool.execute(`
          SELECT 
            ShipmentStatus,
            TrackingNumber,
            EstimatedDelivery,
            ShippingAddress,
            CourierService,
            StatusUpdatedAt,
            ShipmentNotes
          FROM shipments
          WHERE OrderID = ?
        `, [order.OrderID]);

        if (shipmentRows.length > 0) {
          shipmentData = shipmentRows[0];
        }
      } catch (shipmentError) {
        console.log("Shipments table might not exist, using default values");
      }

      // Apply status filter if specified
      if (
        status &&
        status !== "all" &&
        shipmentData.ShipmentStatus !== status
      ) {
        continue;
      }

      ordersWithShipments.push({
        ...order,
        ...shipmentData,
      });
    }

    // Get total count
    const [countRows] = await pool.execute(`
      SELECT COUNT(*) as total
      FROM orders o
      LEFT JOIN users u ON o.UserEmail = u.UserEmail
      ${whereClause}
    `);

    const total = countRows[0].total;
    const totalPages = Math.ceil(total / limit);

    const formattedShipments = ordersWithShipments.map((shipment) => ({
      id: shipment.OrderID,
      orderNumber: `#${shipment.OrderID}`,
      customer: {
        name:
          shipment.UserName && shipment.UserLastName
            ? `${shipment.UserName} ${shipment.UserLastName}`
            : shipment.UserEmail,
        email: shipment.UserEmail,
      },
      product: {
        name: shipment.ProductName || `Product ID: ${shipment.ProductID}`,
        image: shipment.ProductImageURL,
      },
      total: `PKR ${shipment.TotalPrice}`,
      quantity: shipment.Quantity,
      status: shipment.ShipmentStatus,
      trackingNumber: shipment.TrackingNumber,
      estimatedDelivery: shipment.EstimatedDelivery,
      courierService: shipment.CourierService,
      orderDate: new Date(shipment.OrderDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      lastUpdated: shipment.StatusUpdatedAt
        ? new Date(shipment.StatusUpdatedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })
        : "Not updated",
      notes: shipment.ShipmentNotes,
    }));

    res.json({
      success: true,
      data: {
        shipments: formattedShipments,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      },
      message: `Found ${formattedShipments.length} shipments`,
    });
  } catch (error) {
    console.error("Error fetching CMS shipments:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching shipments",
      error: error.message,
    });
  }
});

// Update shipment status (CMS Admin)
app.put("/api/cms/shipments/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const {
      shipmentStatus,
      trackingNumber,
      estimatedDelivery,
      shippingAddress,
      courierService,
      notes,
    } = req.body;

    console.log(`Updating shipment for order ${orderId}:`, req.body);

    // First, verify the order exists
    const [orderRows] = await pool.execute(
      'SELECT OrderID FROM orders WHERE OrderID = ?',
      [orderId]
    );

    if (orderRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Try to create the Shipments table if it doesn't exist
    try {
      console.log("Attempting to create shipments table...");
      // Table is created by database/supabase_schema.sql
      await pool.execute(`SELECT 1 FROM shipments LIMIT 1`);
      console.log("Shipments table operation completed");
    } catch (tableError) {
      console.error("DETAILED ERROR creating Shipments table:", tableError);
    }

    // Check if shipment record exists
    let existingShipment;
    try {
      const [existingRows] = await pool.execute(
        'SELECT * FROM shipments WHERE OrderID = ?',
        [orderId]
      );
      existingShipment = { recordset: existingRows };
    } catch (selectError) {
      console.log("Error checking existing shipment:", selectError.message);
      existingShipment = { recordset: [] };
    }

    if (existingShipment.recordset.length === 0) {
      // Create new shipment record
      try {
        await pool.execute(`
          INSERT INTO shipments 
          (OrderID, ShipmentStatus, TrackingNumber, EstimatedDelivery, ShippingAddress, CourierService, ShipmentNotes, StatusUpdatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          orderId,
          shipmentStatus,
          trackingNumber || "",
          estimatedDelivery || null,
          shippingAddress || "",
          courierService || "Standard Delivery",
          notes || ""
        ]);
        console.log("New shipment record created");
      } catch (insertError) {
        console.error("Error inserting shipment:", insertError);
        throw insertError;
      }
    } else {
      // Update existing shipment record
      try {
        await pool.execute(`
          UPDATE shipments 
          SET ShipmentStatus = ?,
              TrackingNumber = ?,
              EstimatedDelivery = ?,
              ShippingAddress = ?,
              CourierService = ?,
              ShipmentNotes = ?,
              StatusUpdatedAt = NOW()
          WHERE OrderID = ?
        `, [
          shipmentStatus,
          trackingNumber || "",
          estimatedDelivery || null,
          shippingAddress || "",
          courierService || "Standard Delivery",
          notes || "",
          orderId
        ]);
        console.log("Existing shipment record updated");
      } catch (updateError) {
        console.error("Error updating shipment:", updateError);
        throw updateError;
      }
    }

    res.json({
      success: true,
      message: "Shipment status updated successfully",
    });
  } catch (error) {
    console.error("Error updating shipment status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating shipment status",
      error: error.message,
    });
  }
});

// Get all customers for CMS admin with card information
app.get("/api/cms/customers", async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const offset = (page - 1) * limit;

    // Base query
    let whereClause = "";

    // Add search functionality
    if (search) {
      whereClause += ` WHERE (u.UserEmail LIKE '%${search}%' OR u.UserName LIKE '%${search}%' OR u.UserLastName LIKE '%${search}%')`;
    }

    // Get customers with card information and order statistics
    const [resultRows] = await pool.execute(`
      SELECT 
        u.UserID,
        u.UserEmail,
        u.UserName,
        u.UserLastName,
        u.UserCardNum,
        u.UserNameOnCard,
        u.UserCardExpiry,
        u.UserCvv,
        CASE 
          WHEN u.UserCardNum IS NOT NULL AND u.UserCardNum != '' 
          THEN 1 
          ELSE 0 
        END as HasCard,
        COUNT(o.OrderID) as TotalOrders,
        IFNULL(SUM(o.TotalPrice), 0) as TotalSpent,
        MAX(o.OrderDate) as LastOrderDate
      FROM users u
      LEFT JOIN orders o ON u.UserEmail = o.UserEmail
      ${whereClause}
      GROUP BY u.UserID, u.UserEmail, u.UserName, u.UserLastName, u.UserCardNum, u.UserNameOnCard, u.UserCardExpiry, u.UserCvv
      ORDER BY u.UserID DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // Get total count for pagination
    const [countRows] = await pool.execute(`
      SELECT COUNT(*) as total
      FROM users u
      ${whereClause}
    `);

    const total = countRows[0].total;
    const result = { recordset: resultRows };
    const totalPages = Math.ceil(total / limit);

    // Format the customers for frontend
    const formattedCustomers = result.recordset.map((customer, index) => ({
      id: customer.UserID || `temp-id-${index}`, // Ensure we always have a valid ID
      name:
        customer.UserName && customer.UserLastName
          ? `${customer.UserName} ${customer.UserLastName}`
          : customer.UserEmail || "Unknown User",
      email: customer.UserEmail || "No email",
      orders: customer.TotalOrders || 0,
      totalSpent: `PKR ${customer.TotalSpent || 0}`,
      hasCard: customer.HasCard === 1,
      cardNumber: customer.UserCardNum
        ? `****${customer.UserCardNum.slice(-4)}`
        : "No Card",
      lastOrderDate: customer.LastOrderDate
        ? new Date(customer.LastOrderDate).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })
        : "No orders",
      joinDate: "Unknown", // You can add a UserCreatedDate column if needed
    }));

    res.json({
      success: true,
      data: {
        customers: formattedCustomers,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      },
      message: `Found ${formattedCustomers.length} customers`,
    });
  } catch (error) {
    console.error("Error fetching CMS customers:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching customers",
      error: error.message,
    });
  }
});

// Send real email endpoint with dynamic sender
app.post("/api/cms/emails/send", async (req, res) => {
  try {
    const {
      to,
      cc = "",
      bcc = "",
      subject,
      body,
      senderType = "admin",
      userRole,
      userEmail,
    } = req.body;

    console.log("Email request received:", {
      to,
      cc,
      bcc,
      subject,
      senderType,
      userRole,
      userEmail,
    });

    if (!userRole || !userEmail) {
      return res.status(401).json({
        success: false,
        message: "Please log in to send emails",
      });
    }

    if (!to || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: "To, subject, and body are required",
      });
    }

    // Determine which email account to use
    let emailAccount;
    if (userRole === "admin") {
      // Admin can use any email account
      emailAccount = emailAccounts[senderType];
      if (!emailAccount) {
        return res.status(400).json({
          success: false,
          message: "Invalid sender type selected",
        });
      }
    } else {
      // Non-admin users can only use their own email
      emailAccount = getEmailAccount(userEmail, userRole);
      if (!emailAccount) {
        return res.status(403).json({
          success: false,
          message: "You can only send emails from your own email address",
        });
      }
    }

    console.log(`Using email account: ${emailAccount.email}`);

    // Create transporter with selected email account
    const transporter = createTransporter(
      emailAccount.email,
      emailAccount.password,
      emailAccount.name
    );

    // Prepare email options
    const mailOptions = {
      from: `${emailAccount.name} <${emailAccount.email}>`,
      to: to,
      subject: subject,
      html: body,
      text: body.replace(/<[^>]*>/g, ""),
    };

    if (cc) mailOptions.cc = cc;
    if (bcc) mailOptions.bcc = bcc;

    console.log("Sending email with options:", {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
    });

    // Send email
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);

    // Save to database
    const [sentResult] = await pool.execute(`
      INSERT INTO emails 
      (SenderEmail, RecipientEmail, Subject, Body, HasAttachment, EmailType, IsRead)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `, [emailAccount.email, to, subject, body, false, "sent"]);

    res.json({
      success: true,
      data: {
        emailId: sentResult.insertId,
        messageId: info.messageId,
        from: emailAccount.email,
        to: to,
        subject: subject,
      },
      message: "Email sent successfully!",
    });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({
      success: false,
      message: "Error sending email: " + error.message,
      error: error.message,
    });
  }
});

// ===== LIVE STORE FUNCTIONALITY =====

// Live Store connection management
const activeConnections = new Map(); // userEmail -> socket
const agentSockets = new Map(); // agentEmail -> socket
const pendingRequests = new Map(); // requestId -> { userEmail, userName, timestamp }
const activeCallSessions = new Map(); // sessionId -> { userEmail, agentEmail, startTime }

// Check agent availability endpoint
app.post("/api/live-store/request-connection", async (req, res) => {
  try {
    const { userEmail, userName } = req.body;
    console.log("Connection request from:", { userEmail, userName });

    if (!userEmail || !userName) {
      return res.status(400).json({
        success: false,
        message: "User email and name are required",
      });
    }

    // Check for available agents in database
    const [agentRows] = await pool.execute(`
          SELECT UserID, UserName, UserEmail, isAgent
          FROM users 
          WHERE (isAgent = '1' OR isAgent = 'true' OR isAgent = 'True' OR isAgent = 'TRUE')
          ORDER BY UserName ASC
        `);

    const availableAgents = agentRows;
    console.log("Found agents in database:", availableAgents);
    console.log(
      "Currently connected agent sockets:",
      Array.from(agentSockets.keys())
    );

    if (availableAgents.length === 0) {
      console.log("No agents found in database with isAgent = true");
      return res.json({
        success: true,
        agentsAvailable: false,
        message: "No agents are currently available",
      });
    }

    // Find an online agent (connected via WebSocket)
    const onlineAgent = availableAgents.find((agent) => {
      const isConnected = agentSockets.has(agent.UserEmail);
      console.log(
        `Agent ${agent.UserEmail} (${agent.UserName}) - Connected: ${isConnected}`
      );
      return isConnected;
    });

    if (!onlineAgent) {
      console.log("No agents are currently connected via WebSocket");
      return res.json({
        success: true,
        agentsAvailable: false,
        message: "No agents are currently online",
      });
    }

    console.log("Found online agent:", onlineAgent);

    // Create connection request
    const requestId = `req_${Date.now()}_${userEmail
      .replace("@", "_")
      .replace(".", "_")}`;
    pendingRequests.set(requestId, {
      userEmail,
      userName,
      timestamp: new Date(),
      agentEmail: onlineAgent.UserEmail,
    });

    // Send request to agent via WebSocket
    const agentSocket = agentSockets.get(onlineAgent.UserEmail);
    if (agentSocket) {
      agentSocket.emit("connection-request", {
        requestId,
        userEmail,
        userName,
        timestamp: new Date(),
      });
    }

    res.json({
      success: true,
      agentsAvailable: true,
      agentEmail: onlineAgent.UserEmail,
      agentName: onlineAgent.UserName,
      requestId: requestId,
    });
  } catch (error) {
    console.error("Error processing connection request:", error);
    res.status(500).json({
      success: false,
      message: "Error processing connection request",
      error: error.message,
    });
  }
});

// Debug: Check user agent status
app.get("/api/live-store/check-user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const [userRows] = await pool.execute(
      "SELECT UserID as Id, UserName as Name, UserEmail as Email, isAgent, LastLoginDate FROM users WHERE UserID = ?",
      [userId]
    );

    const user = userRows[0];

    res.json({
      success: true,
      data: {
        user: user,
        isConnectedViaSocket:
          agentSockets.has(userId.toString()) ||
          activeConnections.has(userId.toString()),
        socketType: agentSockets.has(userId.toString())
          ? "agent"
          : activeConnections.has(userId.toString())
          ? "user"
          : "none",
      },
    });
  } catch (error) {
    console.error("Error checking user status:", error);
    res.status(500).json({
      success: false,
      message: "Error checking user status",
      error: error.message,
    });
  }
});

// Get agent status endpoint
app.get("/api/live-store/agent-status", async (req, res) => {
  try {
    const [agentRows] = await pool.execute(`
        SELECT 
          UserID as Id, 
          UserName as Name, 
          UserEmail as Email,
          LastLoginDate,
          CASE 
            WHEN LastLoginDate >= DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 'online'
            WHEN LastLoginDate >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 'recently_active'
            ELSE 'offline'
          END as Status
        FROM users 
        WHERE (isAgent = '1' OR isAgent = 'true' OR isAgent = 'True' OR isAgent = 'TRUE')
        ORDER BY LastLoginDate DESC
      `);

    const agents = agentRows.map((agent) => ({
      ...agent,
      isSocketConnected: agentSockets.has(agent.Id.toString()),
    }));

    res.json({
      success: true,
      data: {
        totalAgents: agents.length,
        onlineAgents: agents.filter((a) => a.isSocketConnected).length,
        agents: agents,
      },
    });
  } catch (error) {
    console.error("Error fetching agent status:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching agent status",
      error: error.message,
    });
  }
});

// End call session endpoint
app.post("/api/live-store/end-session", async (req, res) => {
  try {
    const { sessionId, userId, agentId } = req.body;

    // Remove from active sessions
    if (sessionId && activeCallSessions.has(sessionId)) {
      activeCallSessions.delete(sessionId);
    }

    // Notify both parties via WebSocket
    const userSocket = activeConnections.get(userId?.toString());
    const agentSocket = agentSockets.get(agentId?.toString());

    if (userSocket) {
      userSocket.emit("call-ended", { sessionId });
    }

    if (agentSocket) {
      agentSocket.emit("call-ended", { sessionId });
    }

    res.json({
      success: true,
      message: "Session ended successfully",
    });
  } catch (error) {
    console.error("Error ending session:", error);
    res.status(500).json({
      success: false,
      message: "Error ending session",
      error: error.message,
    });
  }
});

// ===== AUCTION API ENDPOINTS =====

// Auction login endpoint
app.post("/api/auction/login", async (req, res) => {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({
        success: false,
        message: "User ID and password are required",
      });
    }

    // Check if auction user exists with provided credentials
    const [rows] = await pool.execute(`
      SELECT UserId, FirstName, LastName, EmailAddress, PhoneNumber, City, Country, BusinessName, Industry
      FROM auctionusers 
      WHERE UserId = ? AND Password = ?
    `, [userId, password]);

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid User ID or password",
      });
    }

    const user = rows[0];
    res.json({
      success: true,
      message: "Auction Login Successful",
      data: {
        userId: user.UserId,
        firstName: user.FirstName,
        lastName: user.LastName,
        emailAddress: user.EmailAddress,
        phoneNumber: user.PhoneNumber,
        city: user.City,
        country: user.Country,
        businessName: user.BusinessName,
        industry: user.Industry,
      },
    });
  } catch (error) {
    console.error("Error during auction login:", error);
    res.status(500).json({
      success: false,
      message: "Error during auction login",
      error: error.message,
    });
  }
});

// Apply for auction access endpoint
app.post("/api/auction/apply", async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      address,
      city,
      country,
      businessName,
      businessType,
    } = req.body;

    if (
      !firstName ||
      !lastName ||
      !email ||
      !phone ||
      !address ||
      !city ||
      !country
    ) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled",
      });
    }

    // Check if email already exists in auctionusers
    const [existingRows] = await pool.execute(
      'SELECT EmailAddress FROM auctionusers WHERE EmailAddress = ?',
      [email]
    );

    if (existingRows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Email already registered for auction access",
      });
    }

    // Insert into auctionusers table (without UserId and Password - admin approval required)
    const [result] = await pool.execute(`
      INSERT INTO auctionusers 
      (FirstName, LastName, EmailAddress, PhoneNumber, Address, City, Country, BusinessName, Industry) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [firstName, lastName, email, phone, address, city, country, businessName || null, businessType || null]);

    if (result.affectedRows > 0) {
      // Create notification for new auction request
      try {
        await pool.execute(`
          INSERT INTO notifications (type, title, message, isRead, createdAt, updatedAt)
          VALUES (?, ?, ?, false, NOW(), NOW())
        `, [
          'auction',
          'New Auction Request',
          `New auction request from ${firstName} ${lastName} (${email})`
        ]);
      } catch (notificationError) {
        console.error('Error creating notification:', notificationError);
        // Don't fail the main request if notification fails
      }

      res.json({
        success: true,
        message: "Access request submitted successfully!",
        data: {
          email: email,
          firstName: firstName,
          lastName: lastName,
          message:
            "Your access request has been sent. Waiting for admin approval.",
        },
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to submit access request",
      });
    }
  } catch (error) {
    console.error("Error creating auction account:", error);
    res.status(500).json({
      success: false,
      message: "Error creating auction account",
      error: error.message,
    });
  }
});

// Get auction applications (for admin)
app.get("/api/auction/applications", async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT * FROM auctionapplications 
      ORDER BY ApplicationDate DESC
    `);

    res.json({
      success: true,
      data: rows,
      message: "Auction applications fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching auction applications:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching auction applications",
      error: error.message,
    });
  }
});

// Update auction application status
app.put("/api/auction/applications/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be pending, approved, or rejected",
      });
    }

    const [result] = await pool.execute(
      'UPDATE auctionapplications SET Status = ? WHERE ApplicationID = ?',
      [status, id]
    );

    if (result.affectedRows > 0) {
      // If approved, update user's auction access
      if (status === "approved") {
        const [appRows] = await pool.execute(
          'SELECT Email FROM auctionapplications WHERE ApplicationID = ?',
          [id]
        );

        if (appRows.length > 0) {
          const email = appRows[0].Email;
          await pool.execute(
            'UPDATE users SET isAuctioneer = ? WHERE UserEmail = ?',
            ['True', email]
          );
        }
      }

      res.json({
        success: true,
        message: `Application ${status} successfully`,
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }
  } catch (error) {
    console.error("Error updating auction application:", error);
    res.status(500).json({
      success: false,
      message: "Error updating auction application",
      error: error.message,
    });
  }
});

// ===== CMS AUCTION MANAGEMENT ENDPOINTS =====

// Get auction requests (for CMS admin)
app.get("/api/auction/requests", async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        FirstName, LastName, EmailAddress, PhoneNumber, Address, 
        City, Country, BusinessName, Industry
      FROM auctionusers 
      WHERE (UserId IS NULL OR UserId = '') AND (Password IS NULL OR Password = '')
      ORDER BY FirstName ASC
    `);

    res.json({
      success: true,
      data: rows,
      message: "Auction requests fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching auction requests:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching auction requests",
      error: error.message,
    });
  }
});

// Approve auction request and set credentials
app.post("/api/auction/approve", async (req, res) => {
  try {
    const { emailAddress, userId, password } = req.body;

    if (!emailAddress || !userId || !password) {
      return res.status(400).json({
        success: false,
        message: "Email address, User ID, and Password are required",
      });
    }

    // Check if user ID already exists
    const [existingRows] = await pool.execute(
      'SELECT UserId FROM auctionusers WHERE UserId = ?',
      [userId]
    );

    if (existingRows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User ID already exists. Please choose a different User ID.",
      });
    }

    // Update the auction user with credentials
    const [result] = await pool.execute(`
      UPDATE auctionusers 
      SET UserId = ?, Password = ?
      WHERE EmailAddress = ? AND (UserId IS NULL OR UserId = '') AND (Password IS NULL OR Password = '')
    `, [userId, password, emailAddress]);

    if (result.affectedRows > 0) {
      res.json({
        success: true,
        message: "Auction request approved successfully",
        data: {
          emailAddress: emailAddress,
          userId: userId,
        },
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Auction request not found or already processed",
      });
    }
  } catch (error) {
    console.error("Error approving auction request:", error);
    res.status(500).json({
      success: false,
      message: "Error approving auction request",
      error: error.message,
    });
  }
});

// Deny auction request
app.post("/api/auction/deny", async (req, res) => {
  try {
    const { emailAddress } = req.body;

    if (!emailAddress) {
      return res.status(400).json({
        success: false,
        message: "Email address is required",
      });
    }

    // Delete the auction request
    const [result] = await pool.execute(`
      DELETE FROM auctionusers 
      WHERE EmailAddress = ? AND (UserId IS NULL OR UserId = '') AND (Password IS NULL OR Password = '')
    `, [emailAddress]);

    if (result.affectedRows > 0) {
      res.json({
        success: true,
        message: "Auction request denied and removed successfully",
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Auction request not found or already processed",
      });
    }
  } catch (error) {
    console.error("Error denying auction request:", error);
    res.status(500).json({
      success: false,
      message: "Error denying auction request",
      error: error.message,
    });
  }
});

// ===== WEBSOCKET HANDLERS FOR LIVE STORE =====

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // User/Agent authentication and registration
  socket.on("register-user", async (data) => {
    console.log("🔌 Register user data received:", data);
    console.log("🔍 Data keys:", Object.keys(data));
    console.log("🔍 Data values:", Object.values(data));
    
    const { UserEmail, userEmail, isAgent } = data;
    const finalUserEmail = UserEmail || userEmail; // Support both naming conventions
    
    console.log("🔍 Extracted values:", { UserEmail, userEmail, finalUserEmail, isAgent });

    if (!finalUserEmail) {
      console.error("❌ No userEmail provided in register-user event");
      console.error("Available data:", data);
      return;
    }

    if (isAgent) {
      agentSockets.set(finalUserEmail, socket);
      console.log(`🟢 Agent ${finalUserEmail} connected and registered`);
      console.log(`📊 Total agents online: ${agentSockets.size}`);
      console.log(`📋 Agent socket emails: ${Array.from(agentSockets.keys())}`);

      // Note: LastLoginDate column doesn't exist in database, so we skip this update
      console.log(`✅ Agent ${finalUserEmail} connected successfully`);

      // Verify agent exists in database
      try {
        const [verifyRows] = await pool.execute(`
          SELECT UserName, UserEmail, isAgent 
          FROM users 
          WHERE UserEmail = ? AND (isAgent = '1' OR isAgent = 'true' OR isAgent = 'True' OR isAgent = 'TRUE')
        `, [finalUserEmail]);
        console.log(
          `Agent verification result:`,
          verifyRows[0] || "Agent not found in database"
        );
      } catch (error) {
        console.error("Error verifying agent:", error);
      }
    } else {
      activeConnections.set(finalUserEmail, socket);
      console.log(`🔵 User ${finalUserEmail} connected`);
      console.log(`📊 Total users online: ${activeConnections.size}`);
      console.log(`📋 Active user emails: ${Array.from(activeConnections.keys())}`);
    }
  });

  // Handle connection requests from users
  socket.on("request-connection", (data) => {
    console.log('🔔 Connection request received!');
    console.log('🔍 Request data:', data);
    console.log('🔍 Request keys:', Object.keys(data));
    
    const { userEmail, userName } = data;
    console.log('🔔 Connection request from:', userEmail, 'userName:', userName);

    // Find available agents
    const availableAgents = Array.from(agentSockets.keys());
    console.log('🔍 Available agents:', availableAgents);
    console.log('📊 Total agents in map:', agentSockets.size);
    
    if (availableAgents.length === 0) {
      console.log('❌ No agents available');
      socket.emit('connection-declined', { reason: 'No agents available' });
      return;
    }

    // Pick the first available agent
    const selectedAgentEmail = availableAgents[0];
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store pending request
    pendingRequests.set(requestId, {
      requestId,
      userEmail,
      userName,
      agentEmail: selectedAgentEmail,
      timestamp: new Date()
    });

    // Send request to agent
    const agentSocket = agentSockets.get(selectedAgentEmail);
    if (agentSocket) {
      console.log('📤 Sending connection request to agent:', selectedAgentEmail);
      agentSocket.emit('connection-request', {
        requestId,
        userEmail,
        userName,
        timestamp: new Date()
      });
    }
  });

  // Agent accepts connection request
  socket.on("accept-connection", (data) => {
    const { requestId } = data;
    console.log(`🤝 Processing accept-connection for request: ${requestId}`);

    if (pendingRequests.has(requestId)) {
      const request = pendingRequests.get(requestId);
      const sessionId = `session_${Date.now()}_${request.userEmail
        .replace("@", "_")
        .replace(".", "_")}_${request.agentEmail
        .replace("@", "_")
        .replace(".", "_")}`;

      console.log(`📋 Creating session: ${sessionId}`);
      console.log(`👥 Session participants: User(${request.userEmail}) ↔ Agent(${request.agentEmail})`);

      // Create session
      activeCallSessions.set(sessionId, {
        userEmail: request.userEmail,
        agentEmail: request.agentEmail,
        startTime: new Date(),
        status: "active",
      });

      // Get both sockets
      const userSocket = activeConnections.get(request.userEmail);
      const agentSocket = agentSockets.get(request.agentEmail);

      // Notify user that agent accepted
      if (userSocket) {
        console.log(`📤 Sending connection-accepted to user: ${request.userEmail}`);
        userSocket.emit("connection-accepted", {
          sessionId,
          agentEmail: request.agentEmail,
          agentName: request.agentName || 'Agent',
        });
      } else {
        console.error(`❌ User socket not found: ${request.userEmail}`);
      }

      // Notify agent with session info
      if (agentSocket) {
        console.log(`📤 Sending connection-accepted to agent: ${request.agentEmail}`);
        agentSocket.emit("connection-accepted", {
          sessionId,
          userEmail: request.userEmail,
          userName: request.userName || 'User',
        });
      } else {
        console.error(`❌ Agent socket not found: ${request.agentEmail}`);
      }

      // CRITICAL: Trigger WebRTC setup by emitting call-connected to both parties
      setTimeout(() => {
        console.log(`📡 Triggering WebRTC setup for session: ${sessionId}`);
        
        if (userSocket) {
          console.log(`📡 Sending call-connected to user: ${request.userEmail}`);
          userSocket.emit("call-connected", { sessionId });
        }
        
        if (agentSocket) {
          console.log(`📡 Sending call-connected to agent: ${request.agentEmail}`);
          agentSocket.emit("call-connected", { sessionId });
        }
      }, 2000); // Give time for video interfaces to initialize

      // Clean up pending request
      pendingRequests.delete(requestId);

      console.log(`✅ Connection accepted: Session ${sessionId} started and WebRTC triggered`);
    } else {
      console.error(`❌ No pending request found for ID: ${requestId}`);
    }
  });

  // Agent declines connection request
  socket.on("decline-connection", (data) => {
    const { requestId } = data;

    if (pendingRequests.has(requestId)) {
      const request = pendingRequests.get(requestId);

      // Notify user that request was declined
      const userSocket = activeConnections.get(request.userEmail);
      if (userSocket) {
        userSocket.emit("connection-declined", {
          message: "Agent is currently unavailable",
        });
      }

      // Clean up pending request
      pendingRequests.delete(requestId);

      console.log(`Connection declined for request ${requestId}`);
    }
  });

  // Handle call ending
  socket.on("end-call", (data) => {
    const { sessionId } = data;

    if (activeCallSessions.has(sessionId)) {
      const session = activeCallSessions.get(sessionId);

      // Notify both parties
      const userSocket = activeConnections.get(session.userEmail);
      const agentSocket = agentSockets.get(session.agentEmail);

      if (userSocket) {
        userSocket.emit("call-ended", { sessionId });
      }

      if (agentSocket) {
        agentSocket.emit("call-ended", { sessionId });
      }

      // Remove session
      activeCallSessions.delete(sessionId);

      console.log(`Call session ${sessionId} ended`);
    }
  });

  // Handle camera state changes
  socket.on("camera-state-changed", (data) => {
    const { sessionId, isVideoOn, userType } = data;
    console.log(`Camera state changed: ${userType} turned camera ${isVideoOn ? 'on' : 'off'}`);

    // Find the active session
    if (activeCallSessions.has(sessionId)) {
      const session = activeCallSessions.get(sessionId);
      
      // Determine target user email based on who sent the event
      const targetUserEmail = userType === 'agent' ? session.userEmail : session.agentEmail;
      const targetSocket = activeConnections.get(targetUserEmail) || agentSockets.get(targetUserEmail);

      if (targetSocket) {
        targetSocket.emit("camera-state-changed", {
          sessionId,
          isVideoOn,
          userType
        });
      }
    }
  });

  // Handle audio state changes
  socket.on("audio-state-changed", (data) => {
    const { sessionId, isMuted, userType } = data;
    console.log(`Audio state changed: ${userType} ${isMuted ? 'muted' : 'unmuted'} microphone`);

    // Find the active session
    if (activeCallSessions.has(sessionId)) {
      const session = activeCallSessions.get(sessionId);
      
      // Determine target user email based on who sent the event
      const targetUserEmail = userType === 'agent' ? session.userEmail : session.agentEmail;
      const targetSocket = activeConnections.get(targetUserEmail) || agentSockets.get(targetUserEmail);

      if (targetSocket) {
        targetSocket.emit("audio-state-changed", {
          sessionId,
          isMuted,
          userType
        });
      }
    }
  });

  // Handle remote stream requests
  socket.on("request-remote-stream", (data) => {
    const { sessionId, requestedBy } = data;
    console.log(`Remote stream requested by ${requestedBy} in session ${sessionId}`);

    // Find the active session
    if (activeCallSessions.has(sessionId)) {
      const session = activeCallSessions.get(sessionId);
      
      // Determine target user email based on who requested
      const targetUserEmail = requestedBy === 'agent' ? session.userEmail : session.agentEmail;
      const targetSocket = activeConnections.get(targetUserEmail) || agentSockets.get(targetUserEmail);

      if (targetSocket) {
        targetSocket.emit("request-remote-stream", {
          sessionId,
          requestedBy
        });
      }
    }
  });

  // Handle sending stream info
  socket.on("send-stream-info", (data) => {
    const { sessionId, hasVideo, streamId, senderType } = data;
    console.log(`Stream info sent by ${senderType}: hasVideo=${hasVideo}, streamId=${streamId}`);

    // Find the active session
    if (activeCallSessions.has(sessionId)) {
      const session = activeCallSessions.get(sessionId);
      
      // Determine target user email based on who sent the stream info
      const targetUserEmail = senderType === 'agent' ? session.userEmail : session.agentEmail;
      const targetSocket = activeConnections.get(targetUserEmail) || agentSockets.get(targetUserEmail);

      if (targetSocket) {
        targetSocket.emit("receive-stream-info", {
          sessionId,
          hasVideo,
          streamId,
          senderType
        });
      }
    }
  });

  // Handle WebRTC signaling for video calls
  socket.on("webrtc-offer", (data) => {
    const { sessionId, offer, targetUserEmail } = data;
    console.log(`📤 CRITICAL: Routing WebRTC offer for session ${sessionId} to ${targetUserEmail}`);
    console.log(`🔍 CRITICAL: Offer details:`, {
      sessionId,
      targetUserEmail,
      offerType: offer?.type,
      offerSdpLength: offer?.sdp?.length,
      hasVideoInSDP: offer?.sdp?.includes('m=video'),
      hasAudioInSDP: offer?.sdp?.includes('m=audio'),
    });
    
    // Check available connections
    const userSocket = activeConnections.get(targetUserEmail);
    const agentSocket = agentSockets.get(targetUserEmail);
    const targetSocket = userSocket || agentSocket;
    
    console.log(`🔍 CRITICAL: Connection lookup for ${targetUserEmail}:`, {
      hasUserSocket: !!userSocket,
      hasAgentSocket: !!agentSocket,
      foundTargetSocket: !!targetSocket,
      totalActiveConnections: activeConnections.size,
      totalAgentSockets: agentSockets.size,
    });

    if (targetSocket) {
      console.log(`📡 CRITICAL: Sending WebRTC offer to ${targetUserEmail}`);
      targetSocket.emit("webrtc-offer", { sessionId, offer, targetUserEmail });
      console.log(`✅ CRITICAL: WebRTC offer successfully sent to ${targetUserEmail}`);
    } else {
      console.error(`❌ CRITICAL ERROR: Target user ${targetUserEmail} not found for WebRTC offer`);
      console.error(`📋 Available connections:`, {
        activeUsers: Array.from(activeConnections.keys()),
        activeAgents: Array.from(agentSockets.keys()),
      });
    }
  });

  socket.on("webrtc-answer", (data) => {
    const { sessionId, answer, targetUserEmail } = data;
    console.log(`📤 CRITICAL: Routing WebRTC answer for session ${sessionId} to ${targetUserEmail}`);
    console.log(`🔍 CRITICAL: Answer details:`, {
      sessionId,
      targetUserEmail,
      answerType: answer?.type,
      answerSdpLength: answer?.sdp?.length,
      hasVideoInSDP: answer?.sdp?.includes('m=video'),
      hasAudioInSDP: answer?.sdp?.includes('m=audio'),
    });
    
    const userSocket = activeConnections.get(targetUserEmail);
    const agentSocket = agentSockets.get(targetUserEmail);
    const targetSocket = userSocket || agentSocket;

    if (targetSocket) {
      console.log(`📡 CRITICAL: Sending WebRTC answer to ${targetUserEmail}`);
      targetSocket.emit("webrtc-answer", { sessionId, answer, targetUserEmail });
      console.log(`✅ CRITICAL: WebRTC answer successfully sent to ${targetUserEmail}`);
    } else {
      console.error(`❌ CRITICAL ERROR: Target user ${targetUserEmail} not found for WebRTC answer`);
      console.error(`📋 Available connections:`, {
        activeUsers: Array.from(activeConnections.keys()),
        activeAgents: Array.from(agentSockets.keys()),
      });
    }
  });

  socket.on("webrtc-ice-candidate", (data) => {
    const { sessionId, candidate, targetUserEmail } = data;
    console.log(`📤 Routing ICE candidate for session ${sessionId} to ${targetUserEmail}`);
    
    const targetSocket =
      activeConnections.get(targetUserEmail) ||
      agentSockets.get(targetUserEmail);

    if (targetSocket) {
      targetSocket.emit("webrtc-ice-candidate", { sessionId, candidate, targetUserEmail });
      console.log(`✅ ICE candidate sent to ${targetUserEmail}`);
    } else {
      console.error(`❌ Target user ${targetUserEmail} not found for ICE candidate`);
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // Remove from active connections
    for (let [userEmail, userSocket] of activeConnections.entries()) {
      if (userSocket === socket) {
        activeConnections.delete(userEmail);
        console.log(`User ${userEmail} disconnected`);
        break;
      }
    }

    // Remove from agent connections
    for (let [agentEmail, agentSocket] of agentSockets.entries()) {
      if (agentSocket === socket) {
        agentSockets.delete(agentEmail);
        console.log(`Agent ${agentEmail} disconnected`);
        break;
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Network access: http://192.168.100.18:${PORT}`);
  console.log(`WebSocket server ready for Live Store connections`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Get products: http://localhost:${PORT}/api/products`);
  console.log(`Add product: http://localhost:${PORT}/api/products (POST)`);
  console.log(`Login endpoint: http://localhost:${PORT}/api/login`);
  console.log(`Register endpoint: http://localhost:${PORT}/api/register`);
  console.log(`Save Card endpoint: http://localhost:${PORT}/api/save-card`);
  console.log(`Get Card endpoint: http://localhost:${PORT}/api/get-card`);
  console.log(`Google Auth endpoint: http://localhost:${PORT}/api/auth/google`);
  console.log(
    `Upload Image endpoint: http://localhost:${PORT}/api/upload-image`
  );
  console.log(
    `Upload Images endpoint: http://localhost:${PORT}/api/upload-images`
  );
  console.log(
    `Delete Image endpoint: http://localhost:${PORT}/api/delete-image/:publicId`
  );
  console.log(`Get All Images: http://localhost:${PORT}/api/images`);
  console.log(
    `Get Images by Folder: http://localhost:${PORT}/api/images/folder/:folderName`
  );
  console.log(
    `Get Image Details: http://localhost:${PORT}/api/images/:publicId`
  );
  console.log(
    `Search Images: http://localhost:${PORT}/api/images/search/:query`
  );
  console.log(
    `Get User Images: http://localhost:${PORT}/api/images/user/:userId`
  );
  console.log(`Save Review: http://localhost:${PORT}/api/save-review`);
  console.log(
    `Get Product Reviews: http://localhost:${PORT}/api/reviews/product/:productId`
  );
  console.log(
    `Get User Reviews: http://localhost:${PORT}/api/reviews/user/:userEmail`
  );
  console.log(
    `Save User Review: http://localhost:${PORT}/api/save-user-review`
  );
  console.log(
    `Get User Review: http://localhost:${PORT}/api/get-user-review/:userEmail`
  );
  console.log(
    `Get All User Reviews: http://localhost:${PORT}/api/all-user-reviews`
  );
  console.log(`CMS Login endpoint: http://localhost:${PORT}/api/cms/login`);
  console.log(`CMS Users endpoint: http://localhost:${PORT}/api/cms/users`);
  console.log(`Get Emails: http://localhost:${PORT}/api/cms/emails`);
  console.log(`Get Email: http://localhost:${PORT}/api/cms/emails/:emailId`);
  console.log(
    `Send Internal Message: http://localhost:${PORT}/api/cms/emails/send`
  );
  console.log(`Update Email: http://localhost:${PORT}/api/cms/emails/:emailId`);
  console.log(`Delete Email: http://localhost:${PORT}/api/cms/emails/:emailId`);
  console.log(`Bulk Emails: http://localhost:${PORT}/api/cms/emails/bulk`);
  console.log(`Get Email Stats: http://localhost:${PORT}/api/cms/emails/stats`);
  console.log(
    `Get User Orders: http://localhost:${PORT}/api/user-orders/:userEmail`
  );
  console.log(`CMS Get All Orders: http://localhost:${PORT}/api/cms/orders`);
  console.log(
    `CMS Get Order Details: http://localhost:${PORT}/api/cms/orders/:orderId`
  );
  console.log(
    `Save Product Review: http://localhost:${PORT}/api/save-product-review`
  );
  console.log(
    `Get User Product Reviews: http://localhost:${PORT}/api/user-product-reviews/:userEmail`
  );
  console.log(`Setup Roles: http://localhost:${PORT}/api/setup-roles`);
  console.log(
    `Live Store API: http://localhost:${PORT}/api/live-store/request-connection`
  );
  console.log(
    `Agent Status API: http://localhost:${PORT}/api/live-store/agent-status`
  );
  console.log(`Auction Login: http://localhost:${PORT}/api/auction/login`);
  console.log(`Auction Apply: http://localhost:${PORT}/api/auction/apply`);
  console.log(
    `Auction Applications: http://localhost:${PORT}/api/auction/applications`
  );
  console.log(
    `Auction Requests (CMS): http://localhost:${PORT}/api/auction/requests`
  );
  console.log(
    `Auction Approve (CMS): http://localhost:${PORT}/api/auction/approve`
  );
  console.log(`Auction Deny (CMS): http://localhost:${PORT}/api/auction/deny`);
  console.log(`Users (CMS): http://localhost:${PORT}/api/users`);
  console.log(`Auction Products: http://localhost:${PORT}/api/auctionproducts`);
  console.log(`Get Auction Product: http://localhost:${PORT}/api/auctionproducts/:id`);
});

// ===== DASHBOARD API ENDPOINTS =====

// Get all emails for dashboard
app.get("/api/emails", async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT * FROM emails
    `);

    res.json({
      success: true,
      data: rows,
      message: `Found ${rows.length} emails`,
    });
  } catch (error) {
    console.error("Error fetching emails:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching emails",
      error: error.message,
    });
  }
});

// Get all shipments for dashboard
app.get("/api/shipments", async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT * FROM shipments
    `);

    res.json({
      success: true,
      data: rows,
      message: `Found ${rows.length} shipments`,
    });
  } catch (error) {
    console.error("Error fetching shipments:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching shipments",
      error: error.message,
    });
  }
});

// Get all user reviews for dashboard
app.get("/api/userreviews", async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT * FROM userreviews
    `);

    res.json({
      success: true,
      data: rows,
      message: `Found ${rows.length} user reviews`,
    });
  } catch (error) {
    console.error("Error fetching user reviews:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user reviews",
      error: error.message,
    });
  }
});

// Get all auction users for dashboard
app.get("/api/auctionusers", async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT * FROM auctionusers
    `);

    res.json({
      success: true,
      data: rows,
      message: `Found ${rows.length} auction users`,
    });
  } catch (error) {
    console.error("Error fetching auction users:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching auction users",
      error: error.message,
    });
  }
});

// Get all orders for dashboard (simple count)
app.get("/api/orders", async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT * FROM orders
    `);

    res.json({
      success: true,
      data: rows,
      message: `Found ${rows.length} orders`,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching orders",
      error: error.message,
    });
  }
});

// ===== NOTIFICATION SYSTEM ENDPOINTS =====

// Get notifications with pagination
app.get("/api/cms/notifications", async (req, res) => {
  try {
    console.log('Fetching notifications...');
    
    // Simple query without pagination first
    const notificationsQuery = `
      SELECT 
        id,
        type,
        title,
        message,
        isRead,
        createdAt,
        updatedAt
      FROM notifications 
      ORDER BY createdAt DESC 
      LIMIT 20
    `;

    const [notifications] = await pool.execute(notificationsQuery);
    console.log('Notifications fetched:', notifications.length);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        page: 1,
        limit: 20,
        total: notifications.length,
        pages: 1
      }
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
});

// Create notification
app.post("/api/cms/notifications", async (req, res) => {
  try {
    const { type, title, message } = req.body;

    if (!type || !title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Type, title, and message are required'
      });
    }

    const insertQuery = `
      INSERT INTO notifications (type, title, message, isRead, createdAt, updatedAt)
      VALUES (?, ?, ?, false, NOW(), NOW())
    `;

    const [result] = await pool.execute(insertQuery, [type, title, message]);

    res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        type,
        title,
        message,
        isRead: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create notification'
    });
  }
});

// Mark notification as read
app.put("/api/cms/notifications/:id/read", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Notification ID is required'
      });
    }

    const updateQuery = `
      UPDATE notifications 
      SET isRead = true, updatedAt = NOW()
      WHERE id = ?
    `;

    const [result] = await pool.execute(updateQuery, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

// Mark all notifications as read
app.put("/api/cms/notifications/mark-all-read", async (req, res) => {
  try {
    const updateQuery = `
      UPDATE notifications 
      SET isRead = true, updatedAt = NOW()
      WHERE isRead = false
    `;

    const [result] = await pool.execute(updateQuery);

    res.json({
      success: true,
      message: 'All notifications marked as read',
      affectedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
});

// Clear all notifications
app.delete("/api/cms/notifications/clear-all", async (req, res) => {
  try {
    const deleteQuery = 'DELETE FROM notifications';

    const [result] = await pool.execute(deleteQuery);

    res.json({
      success: true,
      message: 'All notifications cleared',
      deletedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Error clearing all notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear all notifications'
    });
  }
});

// Create notification for events
app.post("/api/cms/notifications/create", async (req, res) => {
  try {
    const { event, data } = req.body;

    if (!event || !data) {
      return res.status(400).json({
        success: false,
        message: 'Event and data are required'
      });
    }

    let notification = null;

    switch (event) {
      case 'user_registered':
        notification = {
          type: 'user',
          title: 'New User Registration',
          message: `New user registered: ${data.email || data.name || 'Unknown user'}`
        };
        break;

      case 'order_created':
        notification = {
          type: 'order',
          title: 'New Order Received',
          message: `New order #${data.orderId || data.id} received for ${data.amount || 'unknown amount'}`
        };
        break;

      case 'product_added':
        notification = {
          type: 'product',
          title: 'New Product Added',
          message: `New product "${data.name || data.title}" has been added to inventory`
        };
        break;

      case 'auction_product_added':
        notification = {
          type: 'auction',
          title: 'New Auction Product',
          message: `New auction product "${data.name || data.title}" has been listed`
        };
        break;

      case 'auction_request':
        notification = {
          type: 'auction',
          title: 'New Auction Request',
          message: `New auction request from ${data.name || data.email || 'Unknown user'}`
        };
        break;

      case 'email_received':
        notification = {
          type: 'email',
          title: 'New Email Received',
          message: `New email from ${data.from || 'Unknown sender'}: ${data.subject || 'No subject'}`
        };
        break;

      case 'shipment_created':
        notification = {
          type: 'shipment',
          title: 'New Shipment Created',
          message: `New shipment created for order #${data.orderId || data.id}`
        };
        break;

      case 'review_submitted':
        notification = {
          type: 'review',
          title: 'New Review Submitted',
          message: `New review submitted for product "${data.productName || 'Unknown product'}"`
        };
        break;

      case 'low_stock':
        notification = {
          type: 'warning',
          title: 'Low Stock Alert',
          message: `Product "${data.name || data.title}" is running low on stock (${data.quantity || 0} remaining)`
        };
        break;

      case 'payment_failed':
        notification = {
          type: 'warning',
          title: 'Payment Failed',
          message: `Payment failed for order #${data.orderId || data.id}`
        };
        break;

      case 'system_alert':
        notification = {
          type: 'warning',
          title: data.title || 'System Alert',
          message: data.message || 'System alert'
        };
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid event type'
        });
    }

    // Insert notification into database
    const insertQuery = `
      INSERT INTO notifications (type, title, message, isRead, createdAt, updatedAt)
      VALUES (?, ?, ?, false, NOW(), NOW())
    `;

    const [result] = await pool.execute(insertQuery, [
      notification.type,
      notification.title,
      notification.message
    ]);

    res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        ...notification,
        isRead: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create notification'
    });
  }
});

// Test notifications endpoint
app.get("/api/cms/notifications/test", async (req, res) => {
  try {
    console.log('Testing notifications table...');
    
    // Test if notifications table exists
    try {
      const [result] = await pool.execute('SELECT COUNT(*) as count FROM notifications');
      console.log('Table exists, count:', result[0].count);
      
      res.json({
        success: true,
        message: 'Database connection and notifications table are working correctly',
        database: 'Connected',
        table: 'Exists',
        count: result[0].count
      });
    } catch (tableError) {
      console.error('Table error:', tableError);
      res.status(500).json({
        success: false,
        message: 'Database connected but notifications table not found',
        database: 'Connected',
        table: 'Missing',
        error: tableError.message,
        solution: 'Run the database setup script: database/notifications_table.sql'
      });
    }
  } catch (error) {
    console.error('Test endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Test failed',
      error: error.message
    });
  }
});

// Get user-specific orders (for CMS)
app.get("/api/cms/orders/user/:userEmail", async (req, res) => {
  try {
    const { userEmail } = req.params;
    console.log('Fetching orders for user email:', userEmail);

    const [rows] = await pool.execute(`
      SELECT 
        o.OrderID as id,
        CONCAT('#', o.OrderID) as orderNumber,
        CONCAT('PKR ', o.TotalPrice) as total,
        o.Quantity as quantity,
        o.OrderDate as date,
        COALESCE(p.ProductName, CONCAT('Product ID: ', o.ProductID)) as productName,
        p.ProductImageURL as productImage,
        'PAID' as paymentStatusText,
        'bg-green-100 text-green-800' as paymentStatusColor
      FROM orders o
      LEFT JOIN product p ON o.ProductID = p.ProductID
      WHERE LOWER(o.UserEmail) = LOWER(?)
      ORDER BY o.OrderDate DESC
    `, [userEmail]);

    const formattedOrders = rows.map(order => ({
      id: order.id,
      orderNumber: order.orderNumber,
      total: order.total,
      quantity: order.quantity,
      date: new Date(order.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      product: {
        name: order.productName || 'Unknown Product',
        image: order.productImage
      },
      paymentStatus: {
        text: order.paymentStatusText,
        color: order.paymentStatusColor
      }
    }));

    res.json({
      success: true,
      data: formattedOrders,
      message: `Found ${formattedOrders.length} orders for user ${userEmail}`,
    });
  } catch (error) {
    console.error("Error fetching user orders:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user orders",
      error: error.message,
    });
  }
});

// Test endpoint to check database connection
app.get("/api/cms/test-db", async (req, res) => {
  try {
    console.log('Testing database connection...');
    
    // Test basic connection
    const [testResult] = await pool.execute('SELECT 1 as test');
    console.log('Basic connection test:', testResult);
    
    // Test users table
    const [userCount] = await pool.execute('SELECT COUNT(*) as count FROM users');
    console.log('Users table count:', userCount);
    
    // Test sample user
    const [sampleUser] = await pool.execute('SELECT UserEmail, UserName FROM users LIMIT 1');
    console.log('Sample user:', sampleUser);
    
    res.json({
      success: true,
      data: {
        connection: 'OK',
        userCount: userCount[0].count,
        sampleUser: sampleUser[0] || null
      },
      message: "Database connection test successful"
    });
  } catch (error) {
    console.error("Database test failed:", error);
    res.status(500).json({
      success: false,
      message: "Database test failed",
      error: error.message
    });
  }
});

// Get specific user information (for CMS)
app.get("/api/cms/users/:userEmail", async (req, res) => {
  try {
    const { userEmail } = req.params;
    console.log('=== USER INFO API CALL ===');
    console.log('Fetching user info for email:', userEmail);
    console.log('Email type:', typeof userEmail);
    console.log('Email length:', userEmail.length);

    // Test database connection first
    try {
      const [testResult] = await pool.execute('SELECT 1 as test');
      console.log('Database connection test:', testResult);
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
      throw new Error('Database connection failed: ' + dbError.message);
    }

    // Check if users table exists and has data
    try {
      const [userCount] = await pool.execute('SELECT COUNT(*) as count FROM users');
      console.log('Total users in database:', userCount[0].count);
    } catch (countError) {
      console.error('Error counting users:', countError);
      throw new Error('Error counting users: ' + countError.message);
    }

    // First, let's check what columns exist in the users table
    console.log('Checking users table structure...');
    const [tableInfo] = await pool.execute(`
      SELECT column_name AS "Field"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
      ORDER BY ordinal_position
    `);
    console.log('Users table columns:', tableInfo.map((col) => col.Field));

    // Simple, direct query with only existing columns
    console.log('Executing user query...');
    const [rows] = await pool.execute(`
      SELECT 
        UserID,
        UserName,
        UserLastName,
        UserEmail,
        UserRole,
        IsEmailVerified,
        EmailVerifiedAt
      FROM users 
      WHERE LOWER(UserEmail) = LOWER(?)
    `, [userEmail]);

    console.log('Query executed successfully');
    console.log('Number of rows returned:', rows.length);
    console.log('Raw rows:', rows);

    if (rows.length === 0) {
      console.log('No user found for email:', userEmail);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = rows[0];
    console.log('User found:', user);
    console.log('=== USER INFO API SUCCESS ===');
    res.json({
      success: true,
      data: user,
      message: "User information fetched successfully",
    });
  } catch (error) {
    console.error("=== USER INFO API ERROR ===");
    console.error("Error fetching user information:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Error fetching user information",
      error: error.message,
    });
  }
});

// Add auction product endpoint
app.post("/api/auctionproducts", async (req, res) => {
  try {
    const {
      product_name,
      price,
      image_url,
      product_specs
    } = req.body;

    // Validate required fields
    if (!product_name || !price) {
      return res.status(400).json({
        success: false,
        message: "Product name and price are required",
      });
    }

    // Insert into auctionproducts table
    const [result] = await pool.execute(`
      INSERT INTO auctionproducts 
      (product_name, price, image_url, product_specs, bids, auction_timer) 
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      product_name,
      parseFloat(price),
      image_url || null,
      JSON.stringify(product_specs || []),
      JSON.stringify([]), // Empty bids array
      null // No auction timer initially
    ]);

    const productId = result.insertId;

    // Create notification for new auction product
    try {
      await pool.execute(`
        INSERT INTO notifications (type, title, message, isRead, createdAt, updatedAt)
        VALUES (?, ?, ?, false, NOW(), NOW())
      `, [
        'auction',
        'New Auction Product',
        `New auction product "${product_name}" has been listed for $${price}`
      ]);
    } catch (notificationError) {
      console.error('Error creating notification:', notificationError);
      // Don't fail the main request if notification fails
    }

    res.json({
      success: true,
      message: "Auction product added successfully!",
      data: {
        productid: productId,
        product_name,
        price: parseFloat(price),
        image_url,
        product_specs: product_specs || []
      },
    });
  } catch (error) {
    console.error("Error adding auction product:", error);
    res.status(500).json({
      success: false,
      message: "Error adding auction product",
      error: error.message,
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Network access: http://192.168.100.18:${PORT}`);
  console.log(`WebSocket server ready for Live Store connections`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Get products: http://localhost:${PORT}/api/products`);
  console.log(`Add product: http://localhost:${PORT}/api/products (POST)`);
  console.log(`Login endpoint: http://localhost:${PORT}/api/login`);
  console.log(`Register endpoint: http://localhost:${PORT}/api/register`);
  console.log(`Save Card endpoint: http://localhost:${PORT}/api/save-card`);
  console.log(`Get Card endpoint: http://localhost:${PORT}/api/get-card`);
  console.log(`Google Auth endpoint: http://localhost:${PORT}/api/auth/google`);
  console.log(
    `Upload Image endpoint: http://localhost:${PORT}/api/upload-image`
  );
  console.log(
    `Upload Images endpoint: http://localhost:${PORT}/api/upload-images`
  );
  console.log(
    `Delete Image endpoint: http://localhost:${PORT}/api/delete-image/:publicId`
  );
  console.log(`Get All Images: http://localhost:${PORT}/api/images`);
  console.log(
    `Get Images by Folder: http://localhost:${PORT}/api/images/folder/:folderName`
  );
  console.log(
    `Get Image Details: http://localhost:${PORT}/api/images/:publicId`
  );
  console.log(
    `Search Images: http://localhost:${PORT}/api/images/search/:query`
  );
  console.log(
    `Get User Images: http://localhost:${PORT}/api/images/user/:userId`
  );
  console.log(`Save Review: http://localhost:${PORT}/api/save-review`);
  console.log(
    `Get Product Reviews: http://localhost:${PORT}/api/reviews/product/:productId`
  );
  console.log(
    `Get User Reviews: http://localhost:${PORT}/api/reviews/user/:userEmail`
  );
  console.log(
    `Save User Review: http://localhost:${PORT}/api/save-user-review`
  );
  console.log(
    `Get User Review: http://localhost:${PORT}/api/get-user-review/:userEmail`
  );
  console.log(
    `Get All User Reviews: http://localhost:${PORT}/api/all-user-reviews`
  );
  console.log(`CMS Login endpoint: http://localhost:${PORT}/api/cms/login`);
  console.log(`CMS Users endpoint: http://localhost:${PORT}/api/cms/users`);
  console.log(`Get Emails: http://localhost:${PORT}/api/cms/emails`);
  console.log(`Get Email: http://localhost:${PORT}/api/cms/emails/:emailId`);
  console.log(
    `Send Internal Message: http://localhost:${PORT}/api/cms/emails/send`
  );
  console.log(`Update Email: http://localhost:${PORT}/api/cms/emails/:emailId`);
  console.log(`Delete Email: http://localhost:${PORT}/api/cms/emails/:emailId`);
  console.log(`Bulk Emails: http://localhost:${PORT}/api/cms/emails/bulk`);
  console.log(`Get Email Stats: http://localhost:${PORT}/api/cms/emails/stats`);
  console.log(
    `Get User Orders: http://localhost:${PORT}/api/user-orders/:userEmail`
  );
  console.log(`CMS Get All Orders: http://localhost:${PORT}/api/cms/orders`);
  console.log(
    `CMS Get Order Details: http://localhost:${PORT}/api/cms/orders/:orderId`
  );
  console.log(
    `Save Product Review: http://localhost:${PORT}/api/save-product-review`
  );
  console.log(
    `Get User Product Reviews: http://localhost:${PORT}/api/user-product-reviews/:userEmail`
  );
  console.log(`Setup Roles: http://localhost:${PORT}/api/setup-roles`);
  console.log(
    `Live Store API: http://localhost:${PORT}/api/live-store/request-connection`
  );
  console.log(
    `Agent Status API: http://localhost:${PORT}/api/live-store/agent-status`
  );
  console.log(`Auction Login: http://localhost:${PORT}/api/auction/login`);
  console.log(`Auction Apply: http://localhost:${PORT}/api/auction/apply`);
  console.log(
    `Auction Applications: http://localhost:${PORT}/api/auction/applications`
  );
  console.log(
    `Auction Requests (CMS): http://localhost:${PORT}/api/auction/requests`
  );
  console.log(
    `Auction Approve (CMS): http://localhost:${PORT}/api/auction/approve`
  );
  console.log(`Auction Deny (CMS): http://localhost:${PORT}/api/auction/deny`);
  console.log(`Users (CMS): http://localhost:${PORT}/api/users`);
  console.log(`Auction Products: http://localhost:${PORT}/api/auctionproducts`);
  console.log(`Get Auction Product: http://localhost:${PORT}/api/auctionproducts/:id`);
  console.log(`Get User Orders: http://localhost:${PORT}/api/cms/orders/user/:userEmail`);
  console.log(`Get User Info: http://localhost:${PORT}/api/cms/users/:userEmail`);
  console.log(`Test Database: http://localhost:${PORT}/api/cms/test-db`);
  
  // Add missing API endpoints for dashboard
  console.log(`Get All Emails: http://localhost:${PORT}/api/emails`);
  console.log(`Get All Shipments: http://localhost:${PORT}/api/shipments`);
  console.log(`Get All User Reviews: http://localhost:${PORT}/api/userreviews`);
  console.log(`Get All Auction Users: http://localhost:${PORT}/api/auctionusers`);
  
  // Notification system endpoints
  console.log(`Get Notifications: http://localhost:${PORT}/api/cms/notifications`);
  console.log(`Create Notification: http://localhost:${PORT}/api/cms/notifications (POST)`);
  console.log(`Mark as Read: http://localhost:${PORT}/api/cms/notifications/:id/read (PUT)`);
  console.log(`Mark All Read: http://localhost:${PORT}/api/cms/notifications/mark-all-read (PUT)`);
  console.log(`Clear All: http://localhost:${PORT}/api/cms/notifications/clear-all (DELETE)`);
  console.log(`Create Event: http://localhost:${PORT}/api/cms/notifications/create (POST)`);
  console.log(`Test Notifications: http://localhost:${PORT}/api/cms/notifications/test`);
});

process.on("SIGINT", () => {
  console.log("Shutting down server...");
  pool.end();
  process.exit(0);
});

// Get user's bids from auction products
app.get("/api/user-bids/:username", async (req, res) => {
  try {
    const { username } = req.params;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Username is required",
      });
    }

    // Get all auction products
    const [rows] = await pool.execute("SELECT * FROM auctionproducts");

    // Filter products where the user has placed bids
    const userBids = [];
    
    for (const product of rows) {
      if (product.bids && (typeof product.bids === 'string' ? product.bids.trim() !== '' : true)) {
        try {
          // Handle different data formats in the bids column
          let bids;
          
          // Check if it's already an object (from database driver)
          if (typeof product.bids === 'object') {
            bids = product.bids;
          } else if (typeof product.bids === 'string') {
            // Try to parse JSON string
            const trimmedBids = product.bids.trim();
            
            // Handle empty or invalid JSON
            if (trimmedBids === '' || trimmedBids === 'null' || trimmedBids === 'undefined') {
              continue;
            }
            
            // Handle "[object Object]" case
            if (trimmedBids.includes('[object Object]')) {
              console.log(`Skipping product ${product.productid} with malformed bids data: ${trimmedBids}`);
              continue;
            }
            
            bids = JSON.parse(trimmedBids);
          } else {
            // Skip if bids is not a string or object
            continue;
          }
          
          // Ensure bids is an array
          if (!Array.isArray(bids)) {
            console.log(`Skipping product ${product.productid} - bids is not an array:`, typeof bids);
            continue;
          }
          
          const userBid = bids.find(bid => bid.userName === username);
          
          if (userBid) {
            // Find the highest bid for this product
            const bidAmounts = bids.map(bid => {
              const amount = parseFloat(bid.amount);
              return isNaN(amount) ? 0 : amount;
            });
            const highestBid = Math.max(...bidAmounts);
            const userBidAmount = parseFloat(userBid.amount);
            const isWinning = userBidAmount === highestBid;
            
            // Calculate time remaining (if auction_timer is set)
            let timeLeft = "No time limit";
            let dateTime = "No end date";
            
            if (product.auction_timer) {
              const endTime = new Date(product.auction_timer);
              const now = new Date();
              const timeDiff = endTime - now;
              
              if (timeDiff > 0) {
                const hours = Math.floor(timeDiff / (1000 * 60 * 60));
                const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
                timeLeft = `${hours}h ${minutes}m left`;
                dateTime = endTime.toLocaleDateString() + ", " + endTime.toLocaleTimeString();
              } else {
                timeLeft = "Auction ended";
                dateTime = endTime.toLocaleDateString() + ", " + endTime.toLocaleTimeString();
              }
            }

            // Parse product specs safely
            let productSpecs = [];
            try {
              productSpecs = product.product_specs ? JSON.parse(product.product_specs) : [];
            } catch (error) {
              console.error(`Error parsing product_specs for product ${product.productid}:`, error.message);
              productSpecs = [];
            }

            userBids.push({
              id: product.productid,
              title: product.product_name,
              image: product.image_url || "https://via.placeholder.com/80x80/4F46E5/FFFFFF?text=PRODUCT",
              status: isWinning ? "WINNING" : "OUTBID",
              seller: "Certifurb", // Default seller name
              sellerFeedback: 1000, // Default feedback
              sellerRating: "99.9%", // Default rating
              maxBid: userBidAmount,
              originalBid: userBidAmount, // Same as max bid for now
              bidIncrease: 0, // No increase info in current structure
              currency: "PKR",
              timeLeft: timeLeft,
              dateTime: dateTime,
              currentPrice: highestBid,
              currentPriceCurrency: "PKR",
              numBids: bids.length,
              shippingCost: 0, // No shipping info in current structure
              shippingCurrency: "PKR",
              isHidden: false,
              productSpecs: productSpecs
            });
          }
        } catch (parseError) {
          console.error(`Error parsing bids for product ${product.productid}:`, parseError.message);
          console.error(`Raw bids data:`, product.bids);
          // Continue to next product instead of failing completely
          continue;
        }
      }
    }

    res.json({
      success: true,
      data: userBids,
      message: `Found ${userBids.length} bids for user ${username}`,
    });
  } catch (error) {
    console.error("Error fetching user bids:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user bids",
      error: error.message,
    });
  }
});
