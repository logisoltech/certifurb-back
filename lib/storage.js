require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const storageBucket = (process.env.SUPABASE_STORAGE_BUCKET || "certifurb").trim();

const isStorageConfigured = Boolean(supabaseUrl && supabaseServiceKey);

const supabase = isStorageConfigured
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

function getExtension({ mimetype, originalname }) {
  if (originalname && originalname.includes(".")) {
    return originalname.split(".").pop().toLowerCase();
  }
  return MIME_TO_EXT[mimetype] || "jpg";
}

function buildStoragePath(folder, extension) {
  const safeFolder = folder.replace(/^\/+|\/+$/g, "");
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
  return `${safeFolder}/${filename}`;
}

function toUploadResult(path, size) {
  const { data } = supabase.storage.from(storageBucket).getPublicUrl(path);
  const publicUrl = data.publicUrl;

  return {
    path,
    publicId: path,
    url: publicUrl,
    secure_url: publicUrl,
    size: size || null,
  };
}

async function uploadBuffer(buffer, { folder, contentType, originalName }) {
  if (!isStorageConfigured) {
    throw new Error("Supabase storage is not configured on the server");
  }

  const extension = getExtension({
    mimetype: contentType,
    originalname: originalName,
  });
  const storagePath = buildStoragePath(folder, extension);

  const { data, error } = await supabase.storage
    .from(storageBucket)
    .upload(storagePath, buffer, {
      contentType: contentType || "application/octet-stream",
      upsert: false,
      cacheControl: "3600",
    });

  if (error) {
    throw error;
  }

  return toUploadResult(data.path, buffer.length);
}

async function uploadMulterFile(file, folder) {
  return uploadBuffer(file.buffer, {
    folder,
    contentType: file.mimetype,
    originalName: file.originalname,
  });
}

async function deleteFile(path) {
  if (!isStorageConfigured) {
    throw new Error("Supabase storage is not configured on the server");
  }

  const { error } = await supabase.storage.from(storageBucket).remove([path]);
  if (error) {
    throw error;
  }
}

async function listFiles(prefix, { limit = 10, offset = 0 } = {}) {
  if (!isStorageConfigured) {
    throw new Error("Supabase storage is not configured on the server");
  }

  const safePrefix = prefix.replace(/^\/+|\/+$/g, "");

  const { data, error } = await supabase.storage
    .from(storageBucket)
    .list(safePrefix, {
      limit,
      offset,
      sortBy: { column: "created_at", order: "desc" },
    });

  if (error) {
    throw error;
  }

  return (data || [])
    .filter((item) => item.id)
    .map((item) => {
      const path = `${safePrefix}/${item.name}`;
      const { data: urlData } = supabase.storage
        .from(storageBucket)
        .getPublicUrl(path);

      return {
        publicId: path,
        path,
        url: urlData.publicUrl,
        size: item.metadata?.size || null,
        createdAt: item.created_at,
      };
    });
}

module.exports = {
  storageBucket,
  isStorageConfigured,
  uploadBuffer,
  uploadMulterFile,
  deleteFile,
  listFiles,
};
