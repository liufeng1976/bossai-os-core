import { z } from 'zod';

export { z } from 'zod';

export type AIProviderId = string;
export type AIGatewayOperation = 'generate' | 'chat' | 'embed';

export interface AIGatewayRequest {
  tenantId: string;
  provider?: AIProviderId;
  model?: string;
  promptName: string;
  input: Record<string, unknown>;
  expectedSchema?: z.ZodTypeAny;
  metadata?: Record<string, unknown>;
  operation?: AIGatewayOperation;
}

export interface AITokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AIGatewayResponse<T = unknown> {
  provider: AIProviderId;
  model: string;
  output: T;
  tokenUsage: AITokenUsage;
  costEstimate: number;
  validationStatus: 'valid' | 'not_validated' | 'invalid';
}

export interface AIGatewayClient {
  run<T = unknown>(request: AIGatewayRequest): Promise<AIGatewayResponse<T>>;
}
