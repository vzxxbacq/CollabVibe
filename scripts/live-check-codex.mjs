#!/usr/bin/env node
import process from "node:process";

const isPrecheck = process.argv.includes("--precheck");
const cmd = process.env.CODEX_APP_SERVER_CMD;

if (!cmd) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        code: "ENV_MISSING",
        message: "CODEX_APP_SERVER_CMD is required for live codex tests"
      },
      null,
      2
    )
  );
  process.exit(1);
}

if (isPrecheck) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        code: "PRECHECK_OK",
        message: "live codex env is configured"
      },
      null,
      2
    )
  );
  process.exit(0);
}

// Phase 2 live probe is not implemented in phase 1; keep script executable for gate wiring.
console.log(
  JSON.stringify(
    {
      ok: true,
      code: "LIVE_SMOKE_SKIPPED",
      message: "live smoke placeholder executed",
      command: cmd
    },
    null,
    2
  )
);
