// Image pipeline: validate -> re-encode -> store.
//
// Why re-encode with sharp instead of saving the uploaded bytes?
//  1. Security: a file named photo.jpg can contain anything. sharp only succeeds
//     if the bytes really are an image, and we also check the decoded format.
//  2. Privacy: phone photos carry EXIF metadata (exact GPS, device model).
//     sharp drops all metadata unless asked to keep it.
//  3. Size: photos are resized to max 1600 px and saved as WebP (much smaller).
//
// Three storage drivers share the same interface: save(buffer) -> { url, key },
// remove(key). 'local' writes to server/uploads (fine for development and
// single-server hosting); 'database' keeps photos in PostgreSQL (for hosts whose
// disk is wiped on restart, like Render's free plan); 'cloudinary' uploads to Cloudinary.
import crypto from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { HttpError, badRequest } from '../utils/errors.js';

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_FORMATS = ['jpeg', 'png', 'webp'];

/** Decode, verify and re-encode an uploaded image. Throws 400 for non-images. */
export async function processImage(buffer) {
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw badRequest('The uploaded file is not a valid image');
  }
  if (!ALLOWED_FORMATS.includes(meta.format)) {
    throw badRequest('Photo must be a JPEG, PNG or WebP image');
  }
  try {
    return await sharp(buffer, { limitInputPixels: 40_000_000 })
      .rotate() // apply EXIF orientation before the EXIF is dropped
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw badRequest('The uploaded image could not be processed');
  }
}

// ---------- local disk ----------
const localDriver = {
  async save(buffer) {
    await mkdir(config.uploadDir, { recursive: true });
    const key = `${crypto.randomUUID()}.webp`; // random name: no user input in file paths
    await writeFile(path.join(config.uploadDir, key), buffer);
    return { url: `/uploads/${key}`, key };
  },
  async remove(key) {
    if (!/^[0-9a-f-]{36}\.webp$/.test(key)) return; // never touch unexpected paths
    await unlink(path.join(config.uploadDir, key)).catch(() => {});
  },
};

// ---------- PostgreSQL ----------
export const PHOTO_KEY = /^[0-9a-f-]{36}\.webp$/;

const databaseDriver = {
  async save(buffer) {
    const key = `${crypto.randomUUID()}.webp`;
    await query('INSERT INTO photos (key, data) VALUES ($1, $2)', [key, buffer]);
    return { url: `/uploads/${key}`, key };
  },
  async remove(key) {
    if (!PHOTO_KEY.test(key)) return;
    await query('DELETE FROM photos WHERE key = $1', [key]).catch(() => {});
  },
  /** Photo bytes for GET /uploads/:key, or null if there is no such photo. */
  async read(key) {
    if (!PHOTO_KEY.test(key)) return null;
    const { rows } = await query('SELECT data FROM photos WHERE key = $1', [key]);
    return rows[0]?.data ?? null;
  },
};

// ---------- Cloudinary (signed uploads over its REST API, no SDK needed) ----------
function cloudinaryCreds() {
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(config.cloudinaryUrl);
  if (!m) throw new Error('CLOUDINARY_URL must look like cloudinary://<key>:<secret>@<cloud_name>');
  return { apiKey: m[1], apiSecret: m[2], cloud: m[3] };
}

export function sign(params, secret) {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + secret).digest('hex');
}

const cloudinaryDriver = {
  async save(buffer) {
    const { apiKey, apiSecret, cloud } = cloudinaryCreds();
    const params = { folder: 'civicfix', timestamp: Math.floor(Date.now() / 1000) };
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'image/webp' }), 'photo.webp');
    for (const [k, v] of Object.entries(params)) form.append(k, String(v));
    form.append('api_key', apiKey);
    form.append('signature', sign(params, apiSecret));
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new HttpError(502, 'UPLOAD_FAILED', 'Photo storage is unavailable. Please try again.');
    const data = await res.json();
    return { url: data.secure_url, key: data.public_id };
  },
  async remove(key) {
    const { apiKey, apiSecret, cloud } = cloudinaryCreds();
    const params = { public_id: key, timestamp: Math.floor(Date.now() / 1000) };
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) form.append(k, String(v));
    form.append('api_key', apiKey);
    form.append('signature', sign(params, apiSecret));
    await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, { method: 'POST', body: form }).catch(() => {});
  },
};

export { cloudinaryDriver };
const drivers = { local: localDriver, database: databaseDriver, cloudinary: cloudinaryDriver };
if (!drivers[config.storageDriver]) {
  throw new Error(`STORAGE_DRIVER must be one of: ${Object.keys(drivers).join(', ')}`);
}
export const storage = drivers[config.storageDriver];
