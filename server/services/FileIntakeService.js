'use strict';

const crypto = require('crypto');
const path = require('path');
const { Readable } = require('stream');
const clamav = require('clamav.js');
const { scanInjection, sanitiseFileName } = require('../utils/sanitize');

const DEFAULT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

const MIME_ALIASES = {
  'image/jpg': 'image/jpeg',
};

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_CLAMAV_HOST = '127.0.0.1';
const DEFAULT_CLAMAV_PORT = 3310;
const DEFAULT_CLAMAV_TIMEOUT_MS = 5000;

class FileIntakeError extends Error {
  constructor(message, { status = 400, code = 'file_intake_error', details = null } = {}) {
    super(message);
    this.name = 'FileIntakeError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function normalizeMimeType(value) {
  const normalized = String(value || '').split(';')[0].trim().toLowerCase();
  return MIME_ALIASES[normalized] ?? normalized;
}

function normalizeAllowedMimeTypes(allowedMimeTypes = DEFAULT_ALLOWED_MIME_TYPES) {
  return new Set((allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES).map(normalizeMimeType).filter(Boolean));
}

function coercePositiveInt(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new FileIntakeError(`${field} must be a trusted positive integer.`, {
      status: 400,
      code: 'invalid_scope',
    });
  }
  return parsed;
}

function decodeBase64Payload(fileData, maxBytes = DEFAULT_MAX_BYTES) {
  if (typeof fileData !== 'string') {
    throw new FileIntakeError('fileData must be a base64 string.', { code: 'invalid_base64' });
  }

  const stripped = fileData.replace(/^data:[^;]+;base64,/i, '').replace(/\s/g, '');
  if (!stripped || stripped.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(stripped)) {
    throw new FileIntakeError('fileData must be valid base64.', { code: 'invalid_base64' });
  }

  const padding = stripped.endsWith('==') ? 2 : stripped.endsWith('=') ? 1 : 0;
  const estimatedBytes = Math.floor((stripped.length * 3) / 4) - padding;
  if (estimatedBytes > maxBytes) {
    throw new FileIntakeError(`File exceeds maximum size of ${maxBytes} bytes.`, {
      status: 413,
      code: 'file_too_large',
      details: { size: estimatedBytes, maxBytes },
    });
  }

  const buffer = Buffer.from(stripped, 'base64');
  if (buffer.length > maxBytes) {
    throw new FileIntakeError(`File exceeds maximum size of ${maxBytes} bytes.`, {
      status: 413,
      code: 'file_too_large',
      details: { size: buffer.length, maxBytes },
    });
  }

  return buffer;
}

function sanitizeFilename(filename) {
  const withoutControls = sanitiseFileName(String(filename || 'file'));
  const basename = path.posix.basename(withoutControls.replace(/\\/g, '/')).slice(0, 180).trim();
  const displayName = basename || 'file';

  if (!scanInjection(displayName).clean) {
    throw new FileIntakeError('Filename rejected because it contains prompt-injection language.', {
      status: 400,
      code: 'filename_prompt_injection',
    });
  }

  const storageSafeFilename = displayName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 180) || 'file';

  return {
    fileName: displayName,
    storageSafeFilename,
  };
}

function hasPdfHeader(buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from('%PDF-'));
}

function sniffMagicMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  if (hasPdfHeader(buffer)) return 'application/pdf';

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (buffer.length >= 6) {
    const gifHeader = buffer.subarray(0, 6).toString('ascii');
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif';
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

function assertMimeAllowed({ buffer, claimedMimeType, allowedMimeTypes }) {
  const detectedMimeType = sniffMagicMime(buffer);
  if (!detectedMimeType) {
    throw new FileIntakeError('File type could not be verified from its contents.', {
      status: 415,
      code: 'unverified_mime_type',
    });
  }

  const allowed = normalizeAllowedMimeTypes(allowedMimeTypes);
  if (!allowed.has(detectedMimeType)) {
    throw new FileIntakeError(`File type "${detectedMimeType}" is not allowed.`, {
      status: 415,
      code: 'mime_not_allowed',
      details: { detectedMimeType, allowedMimeTypes: [...allowed] },
    });
  }

  const normalizedClaim = normalizeMimeType(claimedMimeType);
  if (normalizedClaim && normalizedClaim !== detectedMimeType) {
    throw new FileIntakeError(
      `File content is "${detectedMimeType}" but the request claimed "${normalizedClaim}".`,
      {
        status: 415,
        code: 'mime_mismatch',
        details: { detectedMimeType, claimedMimeType: normalizedClaim },
      }
    );
  }

  return detectedMimeType;
}

function resolveClamAvOptions(clamAv = {}) {
  return {
    enabled: parseBoolean(
      clamAv.enabled ?? process.env.FILE_INTAKE_CLAMAV_ENABLED ?? process.env.CLAMAV_ENABLED,
      false
    ),
    host: clamAv.host ?? process.env.FILE_INTAKE_CLAMAV_HOST ?? process.env.CLAMAV_HOST ?? DEFAULT_CLAMAV_HOST,
    port: Number(clamAv.port ?? process.env.FILE_INTAKE_CLAMAV_PORT ?? process.env.CLAMAV_PORT ?? DEFAULT_CLAMAV_PORT),
    timeoutMs: Number(clamAv.timeoutMs ?? process.env.FILE_INTAKE_CLAMAV_TIMEOUT_MS ?? DEFAULT_CLAMAV_TIMEOUT_MS),
    scanner: clamAv.scanner,
  };
}

async function scanWithInjectedScanner(buffer, scanner) {
  const result = await scanner(buffer);
  if (result?.malicious || result?.signature) {
    const signature = result.signature ?? result.malicious;
    throw new FileIntakeError(`File rejected by antivirus scan: ${signature}`, {
      status: 422,
      code: 'malware_detected',
      details: { signature },
    });
  }
  return {
    status: 'clean',
    engine: result?.engine ?? 'injected',
    signature: null,
  };
}

function scanWithClamAv(buffer, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      done(reject, new FileIntakeError('ClamAV scan timed out.', {
        status: 503,
        code: 'clamav_timeout',
      }));
    }, options.timeoutMs);

    try {
      const stream = Readable.from([buffer]);
      clamav.createScanner(options.port, options.host).scan(stream, (err, _object, malicious) => {
        if (err) {
          return done(reject, new FileIntakeError(`ClamAV scan failed: ${err.message}`, {
            status: 503,
            code: 'clamav_unavailable',
          }));
        }
        if (malicious) {
          return done(reject, new FileIntakeError(`File rejected by antivirus scan: ${malicious}`, {
            status: 422,
            code: 'malware_detected',
            details: { signature: malicious },
          }));
        }
        return done(resolve, { status: 'clean', engine: 'clamav.js', signature: null });
      });
    } catch (err) {
      done(reject, new FileIntakeError(`ClamAV scan failed: ${err.message}`, {
        status: 503,
        code: 'clamav_unavailable',
      }));
    }
  });
}

async function scanForMalware(buffer, clamAv = {}) {
  const options = resolveClamAvOptions(clamAv);
  if (!options.enabled) {
    return { status: 'skipped', engine: 'clamav.js', signature: null };
  }
  if (typeof options.scanner === 'function') {
    return scanWithInjectedScanner(buffer, options.scanner);
  }
  return scanWithClamAv(buffer, options);
}

function enforceSize(buffer, maxBytes = DEFAULT_MAX_BYTES) {
  if (!Buffer.isBuffer(buffer)) {
    throw new FileIntakeError('File buffer is required.', { code: 'missing_buffer' });
  }
  if (buffer.length === 0) {
    throw new FileIntakeError('File is empty.', { code: 'empty_file' });
  }
  if (buffer.length > maxBytes) {
    throw new FileIntakeError(`File exceeds maximum size of ${maxBytes} bytes.`, {
      status: 413,
      code: 'file_too_large',
      details: { size: buffer.length, maxBytes },
    });
  }
}

function buildOrgScopedKey(clearedFile, { suffix = '', prefix = null, unique = true } = {}) {
  const basePrefix = prefix ?? clearedFile.storagePrefix;
  const uniquePart = unique ? `${Date.now()}-` : '';
  return `${basePrefix}${uniquePart}${clearedFile.sha256.slice(0, 16)}-${clearedFile.storageSafeFilename}${suffix}`;
}

async function fromBuffer({
  buffer,
  fileName = 'file',
  mimeType = '',
  orgId,
  userId = null,
  source = 'unknown',
  allowedMimeTypes = DEFAULT_ALLOWED_MIME_TYPES,
  maxBytes = DEFAULT_MAX_BYTES,
  clamAv = {},
} = {}) {
  const trustedOrgId = coercePositiveInt(orgId, 'orgId');
  const trustedUserId = userId == null ? null : coercePositiveInt(userId, 'userId');
  const body = Buffer.from(buffer ?? []);

  enforceSize(body, maxBytes);
  const { fileName: cleanedName, storageSafeFilename } = sanitizeFilename(fileName);
  const canonicalMimeType = assertMimeAllowed({
    buffer: body,
    claimedMimeType: mimeType,
    allowedMimeTypes,
  });
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  const scan = await scanForMalware(body, clamAv);

  const clearedFile = {
    kind: 'cleared_file',
    orgId: trustedOrgId,
    userId: trustedUserId,
    source: String(source || 'unknown').slice(0, 120),
    originalName: String(fileName || 'file'),
    fileName: cleanedName,
    storageSafeFilename,
    claimedMimeType: normalizeMimeType(mimeType) || null,
    mimeType: canonicalMimeType,
    size: body.length,
    sha256,
    dedupKey: `${sha256}-${storageSafeFilename}`,
    storagePrefix: `org/${trustedOrgId}/`,
    buffer: body,
    scan,
    toBase64() {
      return body.toString('base64');
    },
  };

  return Object.freeze(clearedFile);
}

async function fromBase64({
  fileData,
  mimeType,
  fileName,
  orgId,
  userId = null,
  source = 'unknown',
  allowedMimeTypes = DEFAULT_ALLOWED_MIME_TYPES,
  maxBytes = DEFAULT_MAX_BYTES,
  clamAv = {},
} = {}) {
  const body = decodeBase64Payload(fileData, maxBytes);
  return fromBuffer({
    buffer: body,
    fileName,
    mimeType,
    orgId,
    userId,
    source,
    allowedMimeTypes,
    maxBytes,
    clamAv,
  });
}

async function fromMulterFile({
  file,
  orgId,
  userId = null,
  source = 'unknown',
  allowedMimeTypes = DEFAULT_ALLOWED_MIME_TYPES,
  maxBytes = DEFAULT_MAX_BYTES,
  clamAv = {},
} = {}) {
  if (!file) {
    throw new FileIntakeError('No file uploaded.', { code: 'missing_file' });
  }
  return fromBuffer({
    buffer: file.buffer,
    fileName: file.originalname,
    mimeType: file.mimetype,
    orgId,
    userId,
    source,
    allowedMimeTypes,
    maxBytes,
    clamAv,
  });
}

module.exports = {
  DEFAULT_ALLOWED_MIME_TYPES,
  DEFAULT_MAX_BYTES,
  FileIntakeError,
  fromBuffer,
  fromBase64,
  fromMulterFile,
  buildOrgScopedKey,
  sniffMagicMime,
  normalizeMimeType,
};
