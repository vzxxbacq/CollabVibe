/**
 * @module services/persistence/factory
 *
 * Factory function to encapsulate all SQLite repository construction.
 * Only `createPersistenceLayer(db)` is exported — individual repo classes
 * are internal implementation details.
 */
import type { DatabaseSync } from "node:sqlite";
import { SqliteAdminStateStore } from "./sqlite-admin-state-store";
import { SqliteApprovalStore } from "./sqlite-approval-store";
import { SqliteAuditStore } from "./sqlite-audit-store";
import { SqlitePluginCatalogStore } from "./sqlite-plugin-catalog-store";
import { SqliteSnapshotRepository } from "./sqlite-snapshot-repository";
import { SqliteMergeSessionRepository } from "./sqlite-merge-session-repository";
import { SqliteTurnRepository } from "./sqlite-turn-repository";
import { SqliteTurnDetailRepository } from "./sqlite-turn-detail-repository";
import { SqliteThreadTurnStateRepository } from "./sqlite-thread-turn-state-repository";
import { SqliteUserRepository } from "./sqlite-user-repository";
import { SqliteUserThreadBindingRepository } from "./sqlite-user-thread-binding-repo";
import { SqliteThreadRegistry } from "./sqlite-thread-registry";

export interface PersistenceLayer {
  adminStateStore: SqliteAdminStateStore;
  approvalStore: SqliteApprovalStore;
  auditStore: SqliteAuditStore;
  pluginCatalogStore: SqlitePluginCatalogStore;
  snapshotRepo: SqliteSnapshotRepository;
  mergeSessionRepo: SqliteMergeSessionRepository;
  turnRepo: SqliteTurnRepository;
  turnDetailRepo: SqliteTurnDetailRepository;
  threadTurnStateRepo: SqliteThreadTurnStateRepository;
  userRepo: SqliteUserRepository;
  userThreadBindingRepo: SqliteUserThreadBindingRepository;
  threadRegistry: SqliteThreadRegistry;
}

export function createPersistenceLayer(db: DatabaseSync): PersistenceLayer {
  return {
    adminStateStore: new SqliteAdminStateStore(db),
    approvalStore: new SqliteApprovalStore(db),
    auditStore: new SqliteAuditStore(db),
    pluginCatalogStore: new SqlitePluginCatalogStore(db),
    snapshotRepo: new SqliteSnapshotRepository(db),
    mergeSessionRepo: new SqliteMergeSessionRepository(db),
    turnRepo: new SqliteTurnRepository(db),
    turnDetailRepo: new SqliteTurnDetailRepository(db),
    threadTurnStateRepo: new SqliteThreadTurnStateRepository(db),
    userRepo: new SqliteUserRepository(db),
    userThreadBindingRepo: new SqliteUserThreadBindingRepository(db),
    threadRegistry: new SqliteThreadRegistry(db),
  };
}
