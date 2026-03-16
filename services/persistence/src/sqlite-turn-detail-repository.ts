import type { DatabaseSync } from "node:sqlite";

import type { TurnDetailRecord, TurnDetailRepository } from "../../orchestrator/src/contracts";

interface TurnDetailRow {
  project_id: string;
  turn_id: string;
  prompt_summary: string | null;
  backend_name: string | null;
  model_name: string | null;
  turn_mode: string | null;
  message: string | null;
  reasoning: string | null;
  tools_json: string | null;
  tool_outputs_json: string | null;
  plan_state_json: string | null;
  agent_note: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteTurnDetailRepository implements TurnDetailRepository {
  constructor(private readonly db: DatabaseSync) {}

  async create(record: TurnDetailRecord): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO turn_details (
        project_id, turn_id, prompt_summary, backend_name, model_name, turn_mode,
        message, reasoning, tools_json, tool_outputs_json, plan_state_json, agent_note,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.projectId,
      record.turnId,
      record.promptSummary ?? null,
      record.backendName ?? null,
      record.modelName ?? null,
      record.turnMode ?? null,
      record.message ?? null,
      record.reasoning ?? null,
      JSON.stringify(record.tools ?? []),
      JSON.stringify(record.toolOutputs ?? []),
      record.planState ? JSON.stringify(record.planState) : null,
      record.agentNote ?? null,
      record.createdAt,
      record.updatedAt,
    );
  }

  async update(record: TurnDetailRecord): Promise<void> {
    await this.create(record);
  }

  async getByTurnId(projectId: string, turnId: string): Promise<TurnDetailRecord | null> {
    const row = this.db.prepare(
      `SELECT * FROM turn_details WHERE project_id = ? AND turn_id = ?`
    ).get(projectId, turnId) as TurnDetailRow | undefined;
    if (!row) return null;
    return {
      projectId: row.project_id,
      turnId: row.turn_id,
      promptSummary: row.prompt_summary ?? undefined,
      backendName: row.backend_name ?? undefined,
      modelName: row.model_name ?? undefined,
      turnMode: (row.turn_mode ?? undefined) as TurnDetailRecord["turnMode"],
      message: row.message ?? undefined,
      reasoning: row.reasoning ?? undefined,
      tools: row.tools_json ? JSON.parse(row.tools_json) as TurnDetailRecord["tools"] : [],
      toolOutputs: row.tool_outputs_json ? JSON.parse(row.tool_outputs_json) as TurnDetailRecord["toolOutputs"] : [],
      planState: row.plan_state_json ? JSON.parse(row.plan_state_json) as TurnDetailRecord["planState"] : undefined,
      agentNote: row.agent_note ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
