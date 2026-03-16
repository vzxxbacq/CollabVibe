export { PluginService } from "./plugin-service";
export {
  BACKEND_SKILL_DIRS,
  ALL_BACKEND_SKILL_DIRS,
  PLUGIN_STAGING_SCOPE,
  defaultPluginDirForBackend,
  resolvePluginCanonicalStore,
  resolvePluginStagingRoot,
} from "./plugin-paths";
export type {
  PluginDefinition,
  ProjectPluginDefinition,
  GithubSubpathImportRequest,
  LocalSourceInstallRequest,
  InspectedLocalSkillSource,
  SkillNameValidationResult,
  PluginChangeEvent,
  McpServerDecl
} from "./plugin-service";
export type { PluginStagingScope } from "./plugin-paths";
