import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSignedDownloadToken,
  createWebhookSignature,
  verifySignedDownloadToken,
  verifyWebhookRequest,
  WebhookSecurityError,
} from '../src/index.js';

const secret = 'bossai-webhook-secret-1234567890';
const token = 'bossai-webhook-token-1234567890';
const rawBody = Buffer.from('{"message":"创建一条汽配内容草稿"}');
const timestamp = 1_800_000_000;
const nonce = 'nonce-12345678';

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof WebhookSecurityError && error.code === code);
}

test('HMAC and token verification require timestamp, nonce, and exact constant-time credentials', () => {
  const signature = createWebhookSignature(secret, { timestamp, nonce, rawBody });
  const verified = verifyWebhookRequest({
    secret,
    token,
    providedSignature: `sha256=${signature}`,
    providedToken: token,
    timestamp,
    nonce,
    rawBody,
    nowSeconds: timestamp + 20,
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.method, 'hmac-sha256+token');
  assert.equal(verified.nonce, nonce);

  expectCode(() => verifyWebhookRequest({
    secret,
    token,
    providedSignature: signature,
    providedToken: 'wrong-token-value-1234567890',
    timestamp,
    nonce,
    rawBody,
    nowSeconds: timestamp,
  }), 'WEBHOOK_TOKEN_INVALID');

  expectCode(() => verifyWebhookRequest({
    secret,
    token,
    providedSignature: createWebhookSignature(secret, { timestamp, nonce, rawBody: 'tampered' }),
    providedToken: token,
    timestamp,
    nonce,
    rawBody,
    nowSeconds: timestamp,
  }), 'WEBHOOK_SIGNATURE_INVALID');
});

test('webhook verification fails closed on missing configuration, stale timestamps, and unsafe nonce', () => {
  expectCode(() => verifyWebhookRequest({ timestamp, nonce, rawBody }), 'WEBHOOK_SECURITY_NOT_CONFIGURED');
  expectCode(() => verifyWebhookRequest({
    secret,
    providedSignature: createWebhookSignature(secret, { timestamp, nonce, rawBody }),
    timestamp,
    nonce,
    rawBody,
    nowSeconds: timestamp + 301,
  }), 'WEBHOOK_TIMESTAMP_EXPIRED');
  expectCode(() => verifyWebhookRequest({
    token,
    providedToken: token,
    timestamp,
    nonce: '../bad',
    rawBody,
    nowSeconds: timestamp,
  }), 'WEBHOOK_NONCE_INVALID');
});

test('signed download tokens bind tenant, resource, filename, and expiry', () => {
  const downloadSecret = 'bossai-download-secret-1234567890';
  const signed = createSignedDownloadToken({
    secret: downloadSecret,
    tenantId: 'tenant-a',
    resourceType: 'workforce_content_pack',
    resourceId: 'run-123',
    filename: 'content.md',
    expiresAt: timestamp + 300,
    nonce: 'download-nonce-1234',
  });
  const payload = verifySignedDownloadToken({
    secret: downloadSecret,
    token: signed,
    nowSeconds: timestamp,
  });
  assert.equal(payload.tenantId, 'tenant-a');
  assert.equal(payload.resourceId, 'run-123');
  assert.equal(payload.filename, 'content.md');

  const [encoded, signature] = signed.split('.');
  const tampered = `${encoded.slice(0, -1)}A.${signature}`;
  expectCode(() => verifySignedDownloadToken({
    secret: downloadSecret,
    token: tampered,
    nowSeconds: timestamp,
  }), 'DOWNLOAD_TOKEN_INVALID');
  expectCode(() => verifySignedDownloadToken({
    secret: downloadSecret,
    token: signed,
    nowSeconds: timestamp + 301,
  }), 'DOWNLOAD_TOKEN_EXPIRED');
});
