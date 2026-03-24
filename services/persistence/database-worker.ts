/**
 * @module services/persistence/database-worker
 *
 * Worker thread that owns the real better-sqlite3 Database instance.
 * Receives SQL commands from the main thread via parentPort,
 * executes them synchronously (in this dedicated thread), and
 * sends results back. The main thread event loop is never blocked.
 *
 * Message protocol:
 *   Main → Worker:  WorkerRequest  (init | prepare-get | prepare-all | prepare-run | exec | batch | close)
 *   Worker → Main:  WorkerResponse (ok | error)
 */
import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";

interface InitRequest {
  id: number;
  method: "init";
  filePath: string;
  pragmas?: string[];
}

interface PrepareGetRequest {
  id: number;
  method: "prepare-get";
  sql: string;
  params: unknown[];
}

interface PrepareAllRequest {
  id: number;
  method: "prepare-all";
  sql: string;
  params: unknown[];
}

interface PrepareRunRequest {
  id: number;
  method: "prepare-run";
  sql: string;
  params: unknown[];
}

interface ExecRequest {
  id: number;
  method: "exec";
  sql: string;
}

interface BatchStatement {
  sql: string;
  params: unknown[];
  op: "run" | "get" | "all";
}

interface BatchRequest {
  id: number;
  method: "batch";
  statements: BatchStatement[];
  transaction?: boolean;
}

interface CloseRequest {
  id: number;
  method: "close";
}

type WorkerRequest =
  | InitRequest
  | PrepareGetRequest
  | PrepareAllRequest
  | PrepareRunRequest
  | ExecRequest
  | BatchRequest
  | CloseRequest;

interface WorkerResponseOk {
  id: number;
  ok: true;
  result: unknown;
}

interface WorkerResponseError {
  id: number;
  ok: false;
  error: string;
}

type WorkerResponse = WorkerResponseOk | WorkerResponseError;

let db: Database.Database | null = null;

function handleRequest(req: WorkerRequest): unknown {
  switch (req.method) {
    case "init": {
      if (db) {
        db.close();
      }
      db = new Database(req.filePath);
      if (req.pragmas) {
        for (const pragma of req.pragmas) {
          db.pragma(pragma);
        }
      }
      return null;
    }

    case "prepare-get": {
      if (!db) throw new Error("database not initialized");
      return db.prepare(req.sql).get(...req.params) ?? null;
    }

    case "prepare-all": {
      if (!db) throw new Error("database not initialized");
      return db.prepare(req.sql).all(...req.params);
    }

    case "prepare-run": {
      if (!db) throw new Error("database not initialized");
      const info = db.prepare(req.sql).run(...req.params);
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    }

    case "exec": {
      if (!db) throw new Error("database not initialized");
      db.exec(req.sql);
      return null;
    }

    case "batch": {
      if (!db) throw new Error("database not initialized");
      const results: unknown[] = [];
      const run = () => {
        for (const stmt of req.statements) {
          const prepared = db!.prepare(stmt.sql);
          switch (stmt.op) {
            case "get":
              results.push(prepared.get(...stmt.params) ?? null);
              break;
            case "all":
              results.push(prepared.all(...stmt.params));
              break;
            case "run": {
              const info = prepared.run(...stmt.params);
              results.push({ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) });
              break;
            }
          }
        }
      };
      if (req.transaction !== false) {
        db.transaction(run)();
      } else {
        run();
      }
      return results;
    }

    case "close": {
      if (db) {
        db.close();
        db = null;
      }
      return null;
    }

    default:
      throw new Error(`unknown method: ${(req as WorkerRequest).method}`);
  }
}

parentPort!.on("message", (req: WorkerRequest) => {
  let response: WorkerResponse;
  try {
    const result = handleRequest(req);
    response = { id: req.id, ok: true, result };
  } catch (error) {
    response = {
      id: req.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  parentPort!.postMessage(response);
});
