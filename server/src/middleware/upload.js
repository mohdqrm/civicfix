// multer reads multipart/form-data (the format browsers use for file uploads).
// Files are kept in memory (max 5 MB, one file) so sharp can verify and
// re-encode them before anything is written to storage.
import multer from 'multer';
import { config } from '../config.js';
import { ALLOWED_MIME } from '../services/imageStorage.js';
import { badRequest } from '../utils/errors.js';

export const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 20, fieldSize: 10_000 },
  fileFilter(_req, file, cb) {
    // First, cheap check on the declared type; processImage() then checks the real bytes.
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(badRequest('Photo must be a JPEG, PNG or WebP image'));
    }
    cb(null, true);
  },
}).single('photo');
