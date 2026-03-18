export function getLiveCodexCommand(env = process.env) {
  const command = env.CODEX_APP_SERVER_CMD?.trim();
  if (!command) {
    return null;
  }
  return command;
}

export function assertLiveEnv(env = process.env) {
  const command = getLiveCodexCommand(env);
  if (!command) {
    const error = new Error("CODEX_APP_SERVER_CMD is required for live codex tests");
    error.code = "ENV_MISSING";
    throw error;
  }
  return { command };
}

export function classifyLiveError(error) {
  const message = String(error?.message ?? "");
  if (error?.code === "ENV_MISSING") {
    return "ENV_MISSING";
  }
  if (/auth/i.test(message)) {
    return "AUTH_INVALID";
  }
  if (/timed out|timeout|econnrefused|eai_again|network|socket|closed before response/i.test(message)) {
    return "TRANSIENT_NETWORK";
  }
  if (/start failed|spawn|not found|enoent|epipe/i.test(message)) {
    return "PROCESS_START_FAILED";
  }
  return "LIVE_CHECK_FAILED";
}
