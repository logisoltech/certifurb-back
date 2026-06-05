require("dotenv").config();

const { Pool } = require("pg");

function buildConnectionString() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const password = process.env.SUPABASE_DB_PASSWORD;
  const projectRef = process.env.SUPABASE_URL?.match(
    /https:\/\/([^.]+)\.supabase\.co/
  )?.[1];

  if (password && projectRef) {
    // Direct connection (default) — copy from Supabase → Database → URI, host db.[ref].supabase.co
    if (process.env.SUPABASE_USE_POOLER === "true") {
      const region = process.env.SUPABASE_DB_REGION || "us-east-1";
      const poolerPrefix = process.env.SUPABASE_POOLER_PREFIX || "aws-0";
      const poolerPort = process.env.SUPABASE_POOLER_PORT || "5432";
      return `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${poolerPrefix}-${region}.pooler.supabase.com:${poolerPort}/postgres`;
    }
    return `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`;
  }

  return null;
}

const connectionString = buildConnectionString();

if (!connectionString) {
  console.error(
    "Missing database config. Set DATABASE_URL or SUPABASE_URL + SUPABASE_DB_PASSWORD in .env"
  );
}

const pgPool = new Pool({
  connectionString,
  ssl: connectionString?.includes("supabase")
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 60000,
});

// PascalCase columns from supabase_schema.sql (must be double-quoted in Postgres)
const QUOTED_IDENTIFIERS = [
  "ApplicationID",
  "ApplicationDate",
  "BusinessName",
  "CourierService",
  "CreatedAt",
  "Email",
  "EmailAddress",
  "EmailID",
  "Body",
  "Address",
  "EmailVerifiedAt",
  "EmailType",
  "EstimatedDelivery",
  "FirstName",
  "HasAttachment",
  "ImageUrls",
  "Industry",
  "IsEmailVerified",
  "IsRead",
  "LastLoginDate",
  "LastName",
  "OrderDate",
  "OrderID",
  "Password",
  "PhoneNumber",
  "ProductAudio",
  "ProductBattery",
  "ProductBluetooth",
  "ProductBrand",
  "ProductCamera",
  "ProductCategory",
  "ProductCpu",
  "ProductDesc",
  "ProductGraphics",
  "ProductID",
  "ProductImageURL",
  "ProductKeyboard",
  "ProductModel",
  "ProductName",
  "ProductOs",
  "ProductPrice",
  "ProductRam",
  "ProductResolution",
  "ProductScreenSize",
  "ProductStorage",
  "ProductWeight",
  "ProductWifi",
  "ProductCount",
  "Quantity",
  "Rating",
  "RecipientEmail",
  "ReviewID",
  "ReviewText",
  "SenderEmail",
  "ShipmentID",
  "ShipmentNotes",
  "ShipmentStatus",
  "ShippingAddress",
  "Status",
  "StatusUpdatedAt",
  "Subject",
  "TotalPrice",
  "TrackingNumber",
  "UpdatedAt",
  "UserCardExpiry",
  "UserCardNum",
  "UserCvv",
  "UserEmail",
  "UserID",
  "UserId",
  "UserImageURL",
  "UserLastName",
  "UserName",
  "UserNameOnCard",
  "UserPassword",
  "UserReview",
  "UserRole",
  "createdAt",
  "isRead",
  "updatedAt",
  "isAgent",
  "isAuctioneer",
];

const INSERT_RETURNING = {
  users: '"UserID"',
  product: '"ProductID"',
  orders: '"OrderID"',
  shipments: '"ShipmentID"',
  userreviews: '"ReviewID"',
  reviews: '"ReviewID"',
  '"Reviews"': '"ReviewID"',
  emails: '"EmailID"',
  notifications: "id",
  auctionproducts: "productid",
  auctionusers: "id",
  auctionapplications: '"ApplicationID"',
  refunds: "id",
};

function transformOutsideStrings(sql, transform) {
  const parts = sql.split(/('(?:''|[^'])*')/g);
  return parts
    .map((part, index) => (index % 2 === 1 ? part : transform(part)))
    .join("");
}

function quoteIdentifiers(sql) {
  return transformOutsideStrings(sql, (chunk) => {
    let result = chunk;
    const sorted = [...QUOTED_IDENTIFIERS].sort((a, b) => b.length - a.length);
    for (const ident of sorted) {
      const pattern = new RegExp(`(?<!")\\b${ident}\\b(?!")`, "g");
      result = result.replace(pattern, `"${ident}"`);
    }
    return result
      .replace(/\bFROM\s+Users\b/gi, "FROM users")
      .replace(/\bJOIN\s+Users\b/gi, "JOIN users")
      .replace(/\bFROM\s+Product\b/gi, "FROM product")
      .replace(/\bJOIN\s+Product\b/gi, "JOIN product")
      .replace(/\bFROM\s+Reviews\b/gi, 'FROM "Reviews"')
      .replace(/\bJOIN\s+Reviews\b/gi, 'JOIN "Reviews"')
      .replace(/\bINTO\s+Reviews\b/gi, 'INTO "Reviews"')
      .replace(/\bUPDATE\s+Reviews\b/gi, 'UPDATE "Reviews"');
  });
}

function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function convertSql(sql) {
  let converted = transformOutsideStrings(sql, (chunk) =>
    chunk
      .replace(/CAST\(([^)]+)\s+AS\s+CHAR\)/gi, "CAST($1 AS TEXT)")
      .replace(/\bIFNULL\(/gi, "COALESCE(")
      .replace(
        /DATE_SUB\(NOW\(\),\s*INTERVAL\s+(\d+)\s+HOUR\)/gi,
        "NOW() - INTERVAL '$1 hours'"
      )
      .replace(
        /DATE_SUB\(NOW\(\),\s*INTERVAL\s+(\d+)\s+DAY\)/gi,
        "NOW() - INTERVAL '$1 days'"
      )
  );

  converted = quoteIdentifiers(converted);
  converted = convertPlaceholders(converted);
  return converted;
}

function appendReturning(sql) {
  const trimmed = sql.trim();
  if (!/^INSERT\s+INTO/i.test(trimmed) || /\bRETURNING\b/i.test(trimmed)) {
    return sql;
  }

  const match = trimmed.match(/^INSERT\s+INTO\s+("?[\w]+"?)/i);
  if (!match) return sql;

  const tableKey = match[1].replace(/"/g, "").toLowerCase();
  const returning =
    INSERT_RETURNING[tableKey] ||
    INSERT_RETURNING[match[1]] ||
    (tableKey === "reviews" ? '"ReviewID"' : null);

  if (!returning) return sql;

  return `${sql.trim().replace(/;+\s*$/, "")} RETURNING ${returning}`;
}

function buildResultHeader(pgResult) {
  const header = {
    affectedRows: pgResult.rowCount ?? 0,
    insertId: 0,
  };

  if (pgResult.rows?.length > 0) {
    const row = pgResult.rows[0];
    header.insertId =
      row.UserID ??
      row.id ??
      row.ReviewID ??
      row.EmailID ??
      row.productid ??
      row.OrderID ??
      row.ShipmentID ??
      row.ApplicationID ??
      row.ProductID ??
      Object.values(row)[0] ??
      0;
  }

  return header;
}

async function execute(sql, params = []) {
  const withReturning = appendReturning(sql);
  const pgSql = convertSql(withReturning);
  const isSelect = /^\s*(SELECT|WITH)\b/i.test(pgSql.trim());

  const pgResult = await pgPool.query(pgSql, params);

  if (isSelect) {
    return [pgResult.rows, pgResult.fields];
  }

  return [buildResultHeader(pgResult), pgResult.fields];
}

async function getConnection() {
  const client = await pgPool.connect();
  return {
    release: () => client.release(),
  };
}

async function end() {
  await pgPool.end();
}

const pool = {
  execute,
  getConnection,
  end,
  query: (sql, params) => pgPool.query(convertSql(sql), params),
};

module.exports = { pool, pgPool, convertSql };
