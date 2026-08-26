import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class WebhookSecurityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WebhookSecurityError';
    this.code = code;
  }
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''), 'utf8');
  const rightBuffer = Buffer.from(String(right ?? ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function bodyBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(String(value ?? ''), 'utf8');
}

function assertSecret(value, field) {
  const secret = String(value ?? '').trim();
  if (!secret) throw new WebhookSecurityError('WEBHOOK_SECURITY_NOT_CONFIGURED', `${field} is not configured.`);
  if (secret.length < 24) throw new WebhookSecurityError('WEBHOOK_SECRET_TOO_SHORT', `${field} must contain at least 24 characters.`);
  return secret;
}

export function createWebhookSignature(secret, { timestamp, nonce, rawBody }) {
  const key = assertSecret(secret, 'Webhook HMAC secret');
  return createHmac('sha256', key)
    .update(String(timestamp))
    .update('.')
    .update(String(nonce))
    .update('.')
    .update(bodyBuffer(rawBody))
    .digest('hex');
}

export function verifyWebhookRequest({
  secret,
  token,
  providedSignature,
  providedToken,
  timestamp,
  nonce,
  rawBody,
  nowSeconds = Math.floor(Date.now() / 1_000),
  maxSkewSeconds = 300,
}) {
  const configuredSecret = String(secret ?? '').trim();
  const configuredToken = String(token ?? '').trim();
  if (!configuredSecret && !configuredToken) {
    throw new WebhookSecurityError('WEBHOOK_SECURITY_NOT_CONFIGURED', 'No webhook token or HMAC secret is configured.');
  }

  const timestampNumber = Number(timestamp);
  if (!Number.isInteger(timestampNumber) || timestampNumber <= 0) {
    throw new WebhookSecurityError('WEBHOOK_TIMESTAMP_INVALID', 'Webhook timestamp must be Unix seconds.');
  }
  if (!Number.isInteger(maxSkewSeconds) || maxSkewSeconds < 30 || maxSkewSeconds > 3_600) {
    throw new WebhookSecurityError('WEBHOOK_SKEW_CONFIG_INVALID', 'Webhook skew window must be between 30 and 3600 seconds.');
  }
  if (Math.abs(nowSeconds - timestampNumber) > maxSkewSeconds) {
    throw new WebhookSecurityError('WEBHOOK_TIMESTAMP_EXPIRED', 'Webhook timestamp is outside the accepted time window.');
  }

  const normalizedNonce = String(nonce ?? '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(normalizedNonce)) {
    throw new WebhookSecurityError('WEBHOOK_NONCE_INVALID', 'Webhook nonce must be 8-128 safe characters.');
  }

  const methods = [];
  if (configuredSecret) {
    const signature = String(providedSignature ?? '').replace(/^sha256=/i, '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(signature)) {
      throw new WebhookSecurityError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature must be a SHA-256 hex digest.');
    }
    const expected = createWebhookSignature(configuredSecret, {
      timestamp: timestampNumber,
      nonce: normalizedNonce,
      rawBody,
    });
    if (!constantTimeEqual(signature, expected)) {
      throw new WebhookSecurityError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature does not match.');
    }
    methods.push('hmac-sha256');
  }

  if (configuredToken) {
    const supplied = String(providedToken ?? '').trim();
    if (!supplied || !constantTimeEqual(supplied, configuredToken)) {
      throw new WebhookSecurityError('WEBHOOK_TOKEN_INVALID', 'Webhook token does not match.');
    }
    methods.push('token');
  }

  return {
    verified: true,
    method: methods.join('+'),
    timestamp: timestampNumber,
    nonce: normalizedNonce,
    expiresAt: timestampNumber + maxSkewSeconds,
  };
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64url(value) {
  try {
    return Buffer.from(String(value), 'base64url').toString('utf8');
  } catch {
    throw new WebhookSecurityError('DOWNLOAD_TOKEN_MALFORMED', 'Download token payload is invalid.');
  }
}

function signDownloadPayload(secret, encodedPayload) {
  return createHmac('sha256', assertSecret(secret, 'Download signing secret'))
    .update(encodedPayload)
    .digest('base64url');
}

export function createSignedDownloadToken({
  secret,
  tenantId,
  resourceType,
  resourceId,
  filename,
  expiresAt,
  nonce = randomBytes(16).toString('hex'),
}) {
  const payload = {
    version: 1,
    tenantId: String(tenantId ?? ''),
    resourceType: String(resourceType ?? ''),
    resourceId: String(resourceId ?? ''),
    filename: String(filename ?? ''),
    expiresAt: Number(expiresAt),
    nonce: String(nonce),
  };
  if (
    !payload.tenantId
    || !/^[A-Za-z0-9._:-]{1,100}$/.test(payload.resourceType)
    || !payload.resourceId
    || !payload.filename
    || payload.filename.includes('/')
    || payload.filename.includes('\\')
    || !Number.isInteger(payload.expiresAt)
    || !/^[A-Za-z0-9._:-]{8,128}$/.test(payload.nonce)
  ) {
    throw new WebhookSecurityError('DOWNLOAD_TOKEN_INPUT_INVALID', 'Signed download token input is invalid.');
  }
  const encodedPayload = base64url(JSON.stringify(payload));
  return `${encodedPayload}.${signDownloadPayload(secret, encodedPayload)}`;
}

export function verifySignedDownloadToken({
  secret,
  token,
  nowSeconds = Math.floor(Date.now() / 1_000),
  maxFutureSeconds = 900,
}) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new WebhookSecurityError('DOWNLOAD_TOKEN_MALFORMED', 'Signed download token is malformed.');
  }
  const expected = signDownloadPayload(secret, parts[0]);
  if (!constantTimeEqual(parts[1], expected)) {
    throw new WebhookSecurityError('DOWNLOAD_TOKEN_INVALID', 'Signed download token signature does not match.');
  }
  let payload;
  try {
    payload = JSON.parse(decodeBase64url(parts[0]));
  } catch {
    throw new WebhookSecurityError('DOWNLOAD_TOKEN_MALFORMED', 'Signed download token payload is invalid JSON.');
  }
  if (
    payload?.version !== 1
    || typeof payload.tenantId !== 'string'
    || typeof payload.resourceType !== 'string'
    || typeof payload.resourceId !== 'string'
    || typeof payload.filename !== 'string'
    || typeof payload.expiresAt !== 'number'
    || typeof payload.nonce !== 'string'
    || payload.filename.includes('/')
    || payload.filename.includes('\\')
  ) {
    throw new WebhookSecurityError('DOWNLOAD_TOKEN_MALFORMED', 'Signed download token fields are invalid.');
  }
  if (!Number.isInteger(payload.expiresAt) || payload.expiresAt < nowSeconds) {
    throw new WebhookSecurityError('DOWNLOAD_TOKEN_EXPIRED', 'Signed download token has expired.');
  }
  if (payload.expiresAt - nowSeconds > maxFutureSeconds) {
    throw new WebhookSecurityError('DOWNLOAD_TOKEN_LIFETIME_INVALID', 'Signed download token lifetime exceeds the allowed maximum.');
  }
  return payload;
}
