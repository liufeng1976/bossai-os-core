import {
  skillEngine,
  type SkillRunInput,
  type SkillRunResult,
} from '@bossai/skill-engine';

export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'waiting_approval';
export type WorkflowPauseReason = 'skill_requires_approval' | 'approval_node';

export interface WorkflowNode {
  id: string;
  type: 'skill' | 'approval' | 'task' | 'knowledge' | 'ai_task' | 'connector' | 'memory' | 'notification';
  skillCode?: string;
  input?: Record<string, unknown>;
}

export interface WorkflowDefinition {
  code: string;
  name: string;
  nodes: WorkflowNode[];
}

export interface WorkflowExecutionContext {
  tenantId: string;
  input: Record<string, unknown>;
  nodeOutputs: Record<string, unknown>;
}

export interface WorkflowCursor {
  waitingNodeIndex: number;
  nextNodeIndex: number;
  waitingNodeId: string;
  reason: WorkflowPauseReason;
}

export interface WorkflowWaitingNode {
  id: string;
  type: 'skill' | 'approval';
  skillCode?: string;
  triggeredByNodeId?: string;
}

export interface WorkflowRunResult {
  runId: string;
  workflowCode: string;
  status: WorkflowStatus;
  nodeResults: Array<Record<string, unknown>>;
  waitingNode?: WorkflowWaitingNode;
  cursor?: WorkflowCursor;
  context?: WorkflowExecutionContext;
}

export interface WorkflowResumeInput {
  run: WorkflowRunResult;
  decision: 'approved' | 'rejected';
  approval?: Record<string, unknown>;
}

export interface SkillEngineClient {
  run(input: SkillRunInput): Promise<SkillRunResult>;
}

/**
 * Interface for external node execution (task, memory, notification).
 * When the workflow encounters a node type that is not natively handled,
 * it delegates to the matching handler.  If no handler is registered the
 * node is treated as an unsupported type.
 */
export interface WorkflowNodeHandler {
  execute(node: WorkflowNode, context: WorkflowExecutionContext): Promise<Record<string, unknown>>;
}

export type NodeHandlerMap = Partial<Record<'task' | 'knowledge' | 'ai_task' | 'connector' | 'memory' | 'notification', WorkflowNodeHandler>>;

export class WorkflowStateError extends Error {
  public readonly code: 'INVALID_RESUME_STATE';

  constructor(message: string, code: 'INVALID_RESUME_STATE') {
    super(message);
    this.name = 'WorkflowStateError';
    this.code = code;
  }
}

/**
 * BossAI Platform owns the Workflow runtime but ships no employee-domain
 * Workflow definitions. Independent Agent plugins provide definitions after
 * installation and permission validation.
 */
export const systemWorkflows: WorkflowDefinition[] = [];

export class WorkflowEngine {
  private readonly skills: SkillEngineClient;
  private readonly workflows: WorkflowDefinition[];
  private readonly nodeHandlers: NodeHandlerMap;

  constructor(
    skills: SkillEngineClient = skillEngine,
    workflows: WorkflowDefinition[] = systemWorkflows,
    nodeHandlers: NodeHandlerMap = {},
  ) {
    this.skills = skills;
    this.workflows = workflows;
    this.nodeHandlers = nodeHandlers;
  }

  async run(tenantId: string, workflowCode: string, input: Record<string, unknown>): Promise<WorkflowRunResult> {
    const runId = crypto.randomUUID();
    const workflow = this.workflows.find((item) => item.code === workflowCode);
    const context: WorkflowExecutionContext = { tenantId, input: { ...input }, nodeOutputs: {} };

    if (!workflow) {
      return {
        runId,
        workflowCode,
        status: 'failed',
        nodeResults: [failureResult('WORKFLOW_NOT_FOUND', `Workflow "${workflowCode}" was not found.`)],
        context,
      };
    }

    return this.execute(workflow, runId, context, [], 0);
  }

  async resume(input: WorkflowResumeInput): Promise<WorkflowRunResult> {
    const { run, decision, approval } = input;
    if (run.status !== 'waiting_approval' || !run.cursor || !run.waitingNode || !run.context) {
      throw new WorkflowStateError('Only a workflow with a complete waiting approval state can be resumed.', 'INVALID_RESUME_STATE');
    }

    const workflow = this.workflows.find((item) => item.code === run.workflowCode);
    if (!workflow || run.cursor.nextNodeIndex < 0 || run.cursor.nextNodeIndex > workflow.nodes.length) {
      throw new WorkflowStateError('The workflow definition or resume cursor is no longer valid.', 'INVALID_RESUME_STATE');
    }
    const waitingDefinition = workflow.nodes[run.cursor.waitingNodeIndex];
    if (
      !waitingDefinition
      || waitingDefinition.id !== run.cursor.waitingNodeId
      || waitingDefinition.id !== run.waitingNode.id
    ) {
      throw new WorkflowStateError('The waiting node no longer matches the workflow definition.', 'INVALID_RESUME_STATE');
    }

    const nodeResults = resolveWaitingNode(run.nodeResults, run.waitingNode.id, decision, approval);
    if (decision === 'rejected') {
      return {
        runId: run.runId,
        workflowCode: run.workflowCode,
        status: 'failed',
        nodeResults,
        context: cloneContext(run.context),
      };
    }

    return this.execute(
      workflow,
      run.runId,
      cloneContext(run.context),
      nodeResults,
      run.cursor.nextNodeIndex,
    );
  }

  private async execute(
    workflow: WorkflowDefinition,
    runId: string,
    context: WorkflowExecutionContext,
    nodeResults: Array<Record<string, unknown>>,
    startIndex: number,
  ): Promise<WorkflowRunResult> {
    for (let index = startIndex; index < workflow.nodes.length; index += 1) {
      const node = workflow.nodes[index];

      if (node.type === 'skill') {
        if (!node.skillCode) {
          nodeResults.push(failureResult('INVALID_SKILL_NODE', `Workflow node "${node.id}" has no skillCode.`, node));
          return completedResult(runId, workflow.code, 'failed', nodeResults, context);
        }

        const result = await this.skills.run({
          tenantId: context.tenantId,
          skillCode: node.skillCode,
          input: {
            ...context.input,
            ...node.input,
            workflowContext: { ...context.nodeOutputs },
          },
        });
        nodeResults.push({ nodeId: node.id, type: node.type, status: result.status, result });

        if (result.status === 'failed') {
          return completedResult(runId, workflow.code, 'failed', nodeResults, context);
        }

        context.nodeOutputs[node.id] = result.output;
        if (result.requiresApproval) {
          const followingNode = workflow.nodes[index + 1];
          if (followingNode?.type === 'approval') {
            nodeResults.push({
              nodeId: followingNode.id,
              type: followingNode.type,
              status: 'waiting_approval',
              triggeredByNodeId: node.id,
            });
            return waitingResult(
              runId,
              workflow.code,
              nodeResults,
              context,
              {
                id: followingNode.id,
                type: 'approval',
                triggeredByNodeId: node.id,
              },
              {
                waitingNodeIndex: index + 1,
                nextNodeIndex: index + 2,
                waitingNodeId: followingNode.id,
                reason: 'skill_requires_approval',
              },
            );
          }

          nodeResults.push({ nodeId: node.id, type: node.type, status: 'waiting_approval', approvalFor: 'skill_output' });
          return waitingResult(
            runId,
            workflow.code,
            nodeResults,
            context,
            { id: node.id, type: 'skill', skillCode: node.skillCode },
            {
              waitingNodeIndex: index,
              nextNodeIndex: index + 1,
              waitingNodeId: node.id,
              reason: 'skill_requires_approval',
            },
          );
        }
        continue;
      }

      if (node.type === 'approval') {
        nodeResults.push({ nodeId: node.id, type: node.type, status: 'waiting_approval' });
        return waitingResult(
          runId,
          workflow.code,
          nodeResults,
          context,
          { id: node.id, type: 'approval' },
          {
            waitingNodeIndex: index,
            nextNodeIndex: index + 1,
            waitingNodeId: node.id,
            reason: 'approval_node',
          },
        );
      }

      // Delegate to existing BossAI services for non-native nodes. The workflow
      // engine remains the only state machine; handlers do not create another workflow runtime.
      const handler = this.nodeHandlers[
        node.type as 'task' | 'knowledge' | 'ai_task' | 'connector' | 'memory' | 'notification'
      ];
      if (handler) {
        try {
          const result = await handler.execute(node, context);
          nodeResults.push({ nodeId: node.id, type: node.type, status: 'completed', result });
          context.nodeOutputs[node.id] = result;
          continue;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          nodeResults.push({ nodeId: node.id, type: node.type, status: 'failed', error: { code: 'HANDLER_FAILED', message } });
          return completedResult(runId, workflow.code, 'failed', nodeResults, context);
        }
      }

      nodeResults.push(failureResult(
        'UNSUPPORTED_NODE_TYPE',
        `Workflow node type "${node.type}" is not supported by the runtime.`,
        node,
      ));
      return completedResult(runId, workflow.code, 'failed', nodeResults, context);
    }

    return completedResult(runId, workflow.code, 'completed', nodeResults, context);
  }
}

function waitingResult(
  runId: string,
  workflowCode: string,
  nodeResults: Array<Record<string, unknown>>,
  context: WorkflowExecutionContext,
  waitingNode: WorkflowWaitingNode,
  cursor: WorkflowCursor,
): WorkflowRunResult {
  return {
    runId,
    workflowCode,
    status: 'waiting_approval',
    nodeResults,
    waitingNode,
    cursor,
    context: cloneContext(context),
  };
}

function completedResult(
  runId: string,
  workflowCode: string,
  status: 'completed' | 'failed',
  nodeResults: Array<Record<string, unknown>>,
  context: WorkflowExecutionContext,
): WorkflowRunResult {
  return { runId, workflowCode, status, nodeResults, context: cloneContext(context) };
}

function failureResult(code: string, message: string, node?: WorkflowNode): Record<string, unknown> {
  return {
    ...(node ? { nodeId: node.id, type: node.type } : {}),
    status: 'failed',
    error: { code, message },
  };
}

function resolveWaitingNode(
  nodeResults: Array<Record<string, unknown>>,
  waitingNodeId: string,
  decision: 'approved' | 'rejected',
  approval?: Record<string, unknown>,
): Array<Record<string, unknown>> {
  let resolved = false;
  const updated = nodeResults.map((result) => {
    if (!resolved && result.nodeId === waitingNodeId && result.status === 'waiting_approval') {
      resolved = true;
      return { ...result, status: decision, approval };
    }
    return { ...result };
  });

  if (!resolved) {
    updated.push({ nodeId: waitingNodeId, type: 'approval_decision', status: decision, approval });
  }
  return updated;
}

function cloneContext(context: WorkflowExecutionContext): WorkflowExecutionContext {
  return {
    tenantId: context.tenantId,
    input: { ...context.input },
    nodeOutputs: { ...context.nodeOutputs },
  };
}

export const workflowEngine = new WorkflowEngine();
