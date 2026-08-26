import {
  z,
  type AIGatewayClient,
  type AIGatewayResponse,
} from '@bossai/ai-contracts';

export type SkillRiskLevel = 'L1' | 'L2' | 'L3' | 'L4';

export interface SkillDefinition {
  code: string;
  name: string;
  version: string;
  promptName: string;
  riskLevel: SkillRiskLevel;
  requiresApproval: boolean;
  outputSchema: z.ZodTypeAny;
}

export interface SkillRunInput {
  runId?: string;
  tenantId: string;
  skillCode: string;
  input: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SkillRunError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SkillRunResult {
  runId: string;
  skillCode: string;
  output: unknown;
  riskLevel: SkillRiskLevel;
  requiresApproval: boolean;
  status: 'completed' | 'failed';
  error?: SkillRunError;
}

export interface SkillRunInternalResult extends SkillRunResult {
  internalUsage?: Pick<AIGatewayResponse, 'provider' | 'model' | 'tokenUsage' | 'costEstimate'>;
}

/**
 * BossAI Platform ships no employee-domain Skills. Independent Agent plugins
 * provide their own definitions and the platform injects them into SkillEngine
 * only after manifest, permission and lifecycle validation.
 */
export const systemSkills: SkillDefinition[] = [];

export class SkillEngine {
  private readonly gateway: AIGatewayClient;
  private readonly skills: SkillDefinition[];

  constructor(
    gateway: AIGatewayClient = unconfiguredGateway,
    skills: SkillDefinition[] = systemSkills,
  ) {
    this.gateway = gateway;
    this.skills = skills;
  }

  async run(input: SkillRunInput): Promise<SkillRunResult> {
    const { internalUsage: _internalUsage, ...result } = await this.runWithUsage(input);
    return result;
  }

  async runWithUsage(input: SkillRunInput): Promise<SkillRunInternalResult> {
    const runId = input.runId ?? crypto.randomUUID();
    const skill = this.skills.find((item) => item.code === input.skillCode);
    if (!skill) {
      const error: SkillRunError = {
        code: 'SKILL_NOT_FOUND',
        message: `Skill "${input.skillCode}" was not found.`,
      };
      return {
        runId,
        skillCode: input.skillCode,
        output: { error },
        riskLevel: 'L1',
        requiresApproval: false,
        status: 'failed',
        error,
      };
    }

    try {
      const response = await this.gateway.run({
        tenantId: input.tenantId,
        promptName: skill.promptName,
        input: input.input,
        expectedSchema: skill.outputSchema,
        metadata: input.metadata,
      });

      const validation = skill.outputSchema.safeParse(response.output);
      if (response.validationStatus !== 'valid' || !validation.success) {
        const error: SkillRunError = {
          code: 'OUTPUT_VALIDATION_FAILED',
          message: `Skill "${skill.code}" returned output that does not match its declared schema.`,
          ...(!validation.success ? { details: { issues: validation.error.issues } } : {}),
        };
        return {
          runId,
          skillCode: skill.code,
          output: { error },
          riskLevel: skill.riskLevel,
          requiresApproval: skill.requiresApproval,
          status: 'failed',
          error,
          internalUsage: {
            provider: response.provider,
            model: response.model,
            tokenUsage: response.tokenUsage,
            costEstimate: response.costEstimate,
          },
        };
      }

      return {
        runId,
        skillCode: skill.code,
        output: validation.data,
        riskLevel: skill.riskLevel,
        requiresApproval: skill.requiresApproval,
        status: 'completed',
        internalUsage: {
          provider: response.provider,
          model: response.model,
          tokenUsage: response.tokenUsage,
          costEstimate: response.costEstimate,
        },
      };
    } catch (cause) {
      const error = normalizeError(cause);
      return {
        runId,
        skillCode: skill.code,
        output: { error },
        riskLevel: skill.riskLevel,
        requiresApproval: skill.requiresApproval,
        status: 'failed',
        error,
      };
    }
  }
}

function normalizeError(cause: unknown): SkillRunError {
  if (cause instanceof Error) {
    const gatewayError = cause as Error & { code?: string; details?: Record<string, unknown> };
    return {
      code: gatewayError.code ?? 'SKILL_EXECUTION_FAILED',
      message: gatewayError.message,
      details: gatewayError.details,
    };
  }

  return {
    code: 'SKILL_EXECUTION_FAILED',
    message: 'Skill execution failed with an unknown error.',
  };
}

const unconfiguredGateway: AIGatewayClient = {
  async run() {
    throw new Error('No AI gateway client has been configured for this SkillEngine instance.');
  },
};

export const skillEngine = new SkillEngine();
