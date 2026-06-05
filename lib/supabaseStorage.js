const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const crypto = require("crypto");

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "images";

let supabase = null;
let storageStatus = { configured: false };

function trimEnv(value) {
  return typeof value === "string" ? value.trim() : value;
}

function initSupabaseStorage() {
  const url = trimEnv(process.env.SUPABASE_URL);
  const serviceRoleKey = trimEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url || !serviceRoleKey) {
    storageStatus = { configured: false };
    return storageStatus;
  }

  supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  storageStatus = { configured: true, bucket: BUCKET };
  return storageStatus;
}

function getExtension(mimetype, originalName) {
  const fromName = originalName && path.extname(originalName);
  if (fromName) return fromName.toLowerCase();

  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };

  return map[mimetype] || ".jpg";
}

function buildStoragePath(folder, originalName, mimetype) {
  const ext = getExtension(mimetype, originalName);
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
  const cleanFolder = String(folder || "misc").replace(/^\/+|\/+$/g, "");
  return `${cleanFolder}/${filename}`;
}

function getPublicUrl(storagePath) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

function resolveStorageFolder({ folder, userId, uploadType }) {
  if (folder === "products" || uploadType === "product_image") {
    return "products";
  }

  if (userId) {
    return `reviews/user_${userId}`;
  }

  return "uploads";
}

async function uploadBuffer(
  buffer,
  {
    folder = "uploads",
    contentType = "image/jpeg",
    originalName = "",
  } = {}
) {
  if (!storageStatus.configured) {
    throw new Error("Supabase Storage is not configured");
  }

  const storagePath = buildStoragePath(folder, originalName, contentType);

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType,
    upsert: false,
    cacheControl: "3600",
  });

  if (error) {
    throw error;
  }

  const publicUrl = getPublicUrl(storagePath);

  return {
    url: publicUrl,
    secure_url: publicUrl,
    public_id: storagePath,
    path: storagePath,
    bytes: buffer.length,
  };
}

async function listImagesInFolder(folderPrefix, limit = 20) {
  if (!storageStatus.configured) {
    throw new Error("Supabase Storage is not configured");
  }

  const cleanPrefix = String(folderPrefix).replace(/^\/+|\/+$/g, "");
  const { data, error } = await supabase.storage.from(BUCKET).list(cleanPrefix, {
    limit,
    sortBy: { column: "created_at", order: "desc" },
  });

  if (error) {
    throw error;
  }

  return (data || [])
    .filter((item) => item.name && !item.name.endsWith("/"))
    .map((item) => {
      const storagePath = `${cleanPrefix}/${item.name}`;
      return {
        publicId: storagePath,
        url: getPublicUrl(storagePath),
        createdAt: item.created_at || item.updated_at || null,
      };
    });
}

async function deleteImage(storagePath) {
  if (!storageStatus.configured) {
    throw new Error("Supabase Storage is not configured");
  }

  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) {
    throw error;
  }
}

module.exports = {
  initSupabaseStorage,
  uploadBuffer,
  listImagesInFolder,
  deleteImage,
  resolveStorageFolder,
  get storageStatus() {
    return storageStatus;
  },
};
