#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { assertLiveEnv, classifyLiveError } from "./live-env.mjs";

const isPrecheck = process.argv.includes("--precheck");
const MAX_ATTEMPTS = 3;
const RPC_TIMEOUT_MS = 20_000;
const TOTAL_ATTEMPT_TIMEOUT_MS = 90_000;
const BACKOFF_MS = [0, 2_000, 5_000];

function toJson(value) {
  return JSON.stringify(value, null, 2);
}

function printAndExit(payload, code) {
  console.log(toJson(payload));
  process.exit(code);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(ms) {
  const jitter = Math.floor(ms * 0.2 * Math.random());
  return ms + jitter;
}

function writeLiveReport(payload) {
  const reportPath =
    process.env.LIVE_CODEX_REPORT_PATH ||
    path.join(process.cwd(), "docs", "review", "phase2", "live-codex-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createRpcClient(child) {
  let requestId = 0;
  let readBuffer = "";
  const pending = new Map();
  let stdinError = null;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    readBuffer += chunk;
    const lines = readBuffer.split(/\r?\n/g);
    readBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object" || !("id" in parsed)) {
        continue;
      }
      const key = String(parsed.id);
      const resolver = pending.get(key);
      if (!resolver) {
        continue;
      }
      pending.delete(key);
      if (parsed.error) {
        resolver.reject(
          new Error(
            `jsonrpc error ${String(parsed.error.code ?? "unknown")}: ${String(parsed.error.message ?? "unknown")}`
          )
        );
        continue;
      }
      resolver.resolve(parsed.result);
    }
  });

  child.on("close", () => {
    for (const resolver of pending.values()) {
      resolver.reject(new Error("codex app-server closed before response"));
    }
    pending.clear();
  });

  child.stdin.on("error", (error) => {
    stdinError = error;
    for (const resolver of pending.values()) {
      resolver.reject(error);
    }
    pending.clear();
  });

  async function request(method, params) {
    if (stdinError) {
      throw stdinError;
    }
    requestId += 1;
    const id = String(requestId);
    const body = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`request timeout for ${method}`));
      }, RPC_TIMEOUT_MS);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      child.stdin.write(`${body}\n`, (error) => {
        if (!error) {
          return;
        }
        pending.delete(id);
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  function notify(method, params) {
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  return { request, notify };
}

function startServer(command) {
  const child = spawn(command, {
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env
  });

  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  return { child, getStderr: () => stderr };
}

async function runHandshake(command) {
  const startedAt = Date.now();
  const { child, getStderr } = startServer(command);
  const rpc = createRpcClient(child);

  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, TOTAL_ATTEMPT_TIMEOUT_MS);

  try {
    await rpc.request("initialize", {
      clientInfo: {
        name: "collabvibe-live",
        title: "collabvibe-live",
        version: "0.2.0"
      }
    });
    rpc.notify("initialized", {});

    const threadStart = await rpc.request("thread/start", {
      model: "gpt-5-codex",
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandbox: "workspace-write"
    });
    const threadId = threadStart?.thread?.id;
    if (!threadId || typeof threadId !== "string") {
      throw new Error("thread/start missing thread.id");
    }

    const turnStart = await rpc.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "live smoke ping" }]
    });

    const turnId = turnStart?.turn?.id;
    if (turnId && typeof turnId === "string") {
      await rpc.request("turn/interrupt", { threadId, turnId });
    }

    clearTimeout(timeout);
    child.kill("SIGTERM");
    return {
      ok: true,
      code: "LIVE_OK",
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    clearTimeout(timeout);
    child.kill("SIGKILL");
    const stderr = getStderr();
    if (stderr && /not found|enoent/i.test(stderr)) {
      throw new Error(`start failed: ${stderr.trim()}`);
    }
    throw error;
  }
}

function buildOutput(base, attempts) {
  return {
    ...base,
    attempts
  };
}

async function main() {
  let command;
  try {
    ({ command } = assertLiveEnv(process.env));
  } catch (error) {
    const payload = buildOutput(
      {
        ok: false,
        code: "ENV_MISSING",
        message: String(error.message || "CODEX_APP_SERVER_CMD is required")
      },
      []
    );
    writeLiveReport(payload);
    printAndExit(payload, 1);
    return;
  }

  if (isPrecheck) {
    const payload = buildOutput(
      {
        ok: true,
        code: "PRECHECK_OK",
        message: "live codex env is configured",
        command
      },
      []
    );
    writeLiveReport(payload);
    printAndExit(payload, 0);
    return;
  }

  const attempts = [];
  for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
    if (index > 0) {
      await sleep(withJitter(BACKOFF_MS[index]));
    }
    const startedAt = Date.now();
    try {
      const result = await runHandshake(command);
      attempts.push({
        index: index + 1,
        code: result.code,
        durationMs: Date.now() - startedAt
      });
      const payload = buildOutput(
        {
          ok: true,
          code: "LIVE_OK",
          message: "initialize -> thread/start -> turn/start -> interrupt succeeded",
          totalDurationMs: attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0)
        },
        attempts
      );
      writeLiveReport(payload);
      printAndExit(payload, 0);
      return;
    } catch (error) {
      const code = classifyLiveError(error);
      attempts.push({
        index: index + 1,
        code,
        durationMs: Date.now() - startedAt,
        error: String(error.message || error)
      });

      const shouldRetry = code === "TRANSIENT_NETWORK" && index < MAX_ATTEMPTS - 1;
      if (shouldRetry) {
        continue;
      }

      const payload = buildOutput(
        {
          ok: false,
          code,
          message: String(error.message || "live check failed"),
          totalDurationMs: attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0)
        },
        attempts
      );
      writeLiveReport(payload);
      printAndExit(payload, 1);
      return;
    }
  }
}

await main();
