/**
 * @module services/persistence/factory
 *
 * Factory function to encapsulate all SQLite repository construction.
 * Only `createPersistenceLayer(db)` is exported — individual repo classes
 * are internal implementation details.
 */
import type { AsyncDatabaseProxy } from "./async-database-proxy";
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

export async function createPersistenceLayer(db: AsyncDatabaseProxy): Promise<PersistenceLayer> {
  const adminStateStore = new SqliteAdminStateStore(db);
  const userRepo = new SqliteUserRepository(db);
  const pluginCatalogStore = new SqlitePluginCatalogStore(db);
  const mergeSessionRepo = new SqliteMergeSessionRepository(db);

  // Initialize repos that have DDL (CREATE TABLE IF NOT EXISTS)
  await adminStateStore.init();
  await userRepo.init();
  await pluginCatalogStore.init();
  await mergeSessionRepo.init();

  return {
    adminStateStore,
    approvalStore: new SqliteApprovalStore(db),
    auditStore: new SqliteAuditStore(db),
    pluginCatalogStore,
    snapshotRepo: new SqliteSnapshotRepository(db),
    mergeSessionRepo,
    turnRepo: new SqliteTurnRepository(db),
    turnDetailRepo: new SqliteTurnDetailRepository(db),
    threadTurnStateRepo: new SqliteThreadTurnStateRepository(db),
    userRepo,
    userThreadBindingRepo: new SqliteUserThreadBindingRepository(db),
    threadRegistry: new SqliteThreadRegistry(db),
  };
}
