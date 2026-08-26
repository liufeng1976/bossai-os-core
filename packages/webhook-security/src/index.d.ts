export class WebhookSecurityError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export function createWebhookSignature(secret: string, input: {
  timestamp: number | string;
  nonce: string;
  rawBody: Buffer | Uint8Array | string;
}): string;

export function verifyWebhookRequest(input: {
  secret?: string;
  token?: string;
  providedSignature?: string;
  providedToken?: string;
  timestamp: number | string;
  nonce: string;
  rawBody: Buffer | Uint8Array | string;
  nowSeconds?: number;
  maxSkewSeconds?: number;
}): {
  verified: true;
  method: string;
  timestamp: number;
  nonce: string;
  expiresAt: number;
};

export interface SignedDownloadPayload {
  version: 1;
  tenantId: string;
  resourceType: string;
  resourceId: string;
  filename: string;
  expiresAt: number;
  nonce: string;
}

export function createSignedDownloadToken(input: {
  secret: string;
  tenantId: string;
  resourceType: string;
  resourceId: string;
  filename: string;
  expiresAt: number;
  nonce?: string;
}): string;

export function verifySignedDownloadToken(input: {
  secret: string;
  token: string;
  nowSeconds?: number;
  maxFutureSeconds?: number;
}): SignedDownloadPayload;
