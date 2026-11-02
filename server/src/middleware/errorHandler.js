import multer from 'multer';
import { HttpError } from '../utils/errors.js';
import { config } from '../config.js';

// PostgreSQL error codes we can explain to the user instead of returning a 500.
const PG_ERRORS = {
  '23505': [409, 'CONFLICT', 'That record already exists'],
  '23503': [400, 'BAD_REQUEST', 'A referenced record does not exist'],
  '23514': [400, 'BAD_REQUEST', 'A value is outside the allowed range'],
  '22P02': [400, 'BAD_REQUEST', 'A value has the wrong format'],
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side. Please try again.';
  let details;

  if (err instanceof HttpError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = 'UPLOAD_ERROR';
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `Photo is too large (max ${config.maxUploadBytes / 1024 / 1024} MB)`
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Only one photo, in the "photo" field, is allowed'
          : 'Could not read the uploaded file';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Request body is not valid JSON';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  } else if (err.code && PG_ERRORS[err.code]) {
    [status, code, message] = PG_ERRORS[err.code];
  } else if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    // 4xx errors raised by Express itself (e.g. static files: missing → 404, dotfile → 403)
    status = err.status;
    code = status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'BAD_REQUEST';
    message = status === 404 ? 'Not found' : status === 403 ? 'Forbidden' : 'Bad request';
  }

  // Always log unexpected errors (tests included — a 500 in a test is a bug worth seeing).
  if (status >= 500) console.error(err);
  // Internal details (stack traces, SQL) are never sent to the browser.
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
