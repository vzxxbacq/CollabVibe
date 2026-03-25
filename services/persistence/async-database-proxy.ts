/**
 * @module services/persistence/async-database-proxy
 *
 * Main-thread proxy that communicates with the database Worker thread.
 * Provides an API surface compatible with the existing DatabaseSync usage
 * (`.prepare(sql).get(...)`, `.all(...)`, `.run(...)`, `.exec(sql)`)
 * but returns Promises, freeing the event loop.
 *
 * Usage:
 *   const db = await AsyncDatabaseProxy.create(filePath, { enableWal: true });
 *   const row = await db.get(sql, ...params);
 *   const rows = await db.all(sql, ...params);
 *   const info = await db.run(sql, ...params);
 *   await db.exec(sql);
 *   const results = await db.batch([...], { transaction: true });
 *   await db.close();
 */
import { Worker } from "node:worker_threads";
import { join } from "node:path";

/** Absolute path to the Worker entry point (resolved at module load). */
const WORKER_PATH = join(__dirname, "database-worker.ts");

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

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface BatchStatement {
  sql: string;
  params: unknown[];
  op: "run" | "get" | "all";
}

export interface DatabaseOptions {
  enableWal?: boolean;
  busyTimeoutMs?: number;
}

/**
 * Prepared statement proxy.
 * Mimics `.prepare(sql).get(...)` / `.all(...)` / `.run(...)` pattern
 * but each call returns a Promise (dispatched to Worker).
 */
export class AsyncStatementProxy {
  constructor(
    private readonly proxy: AsyncDatabaseProxy,
    private readonly sql: string,
  ) { }

  get(...params: unknown[]): Promise<unknown> {
    return this.proxy.get(this.sql, ...params);
  }

  all(...params: unknown[]): Promise<unknown[]> {
    return this.proxy.all(this.sql, ...params);
  }

  run(...params: unknown[]): Promise<RunResult> {
    return this.proxy.run(this.sql, ...params);
  }
}

export class AsyncDatabaseProxy {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private closed = false;

  private constructor(worker: Worker) {
    this.worker = worker;
    this.worker.on("message", (msg: WorkerResponse) => {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        entry.resolve(msg.result);
      } else {
        entry.reject(new Error(msg.error));
      }
    });
    this.worker.on("error", (err) => {
      // Reject all pending
      for (const [, entry] of this.pending) {
        entry.reject(err);
      }
      this.pending.clear();
    });
  }

  /**
   * Create and initialize an AsyncDatabaseProxy.
   * Opens the database file in the Worker thread and runs PRAGMA setup.
   */
  static async create(filePath: string, options: DatabaseOptions = {}): Promise<AsyncDatabaseProxy> {
    const worker = new Worker(WORKER_PATH);
    const proxy = new AsyncDatabaseProxy(worker);

    const pragmas: string[] = [];
    if (options.enableWal !== false) {
      pragmas.push("journal_mode = WAL");
    }
    pragmas.push(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
    pragmas.push("foreign_keys = ON");

    await proxy.send({ method: "init", filePath, pragmas });
    return proxy;
  }

  private send(req: Omit<{ id: number; method: string;[k: string]: unknown }, "id">): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error("database proxy is closed"));
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...req });
    });
  }

  /**
   * Returns a statement-like object with .get(), .all(), .run() methods.
   * Each method returns a Promise. This allows existing code patterns like:
   *   await this.db.prepare(sql).get(...params)
   * to work with minimal changes (just add `await`).
   */
  prepare(sql: string): AsyncStatementProxy {
    return new AsyncStatementProxy(this, sql);
  }

  async get(sql: string, ...params: unknown[]): Promise<unknown> {
    return this.send({ method: "prepare-get", sql, params });
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    return this.send({ method: "prepare-all", sql, params }) as Promise<unknown[]>;
  }

  async run(sql: string, ...params: unknown[]): Promise<RunResult> {
    return this.send({ method: "prepare-run", sql, params }) as Promise<RunResult>;
  }

  async exec(sql: string): Promise<void> {
    await this.send({ method: "exec", sql });
  }

  /**
   * Execute multiple statements atomically in a transaction (default)
   * or as a non-transactional batch.
   *
   * Returns an array of results, one per statement, in order.
   * Each result is:
   *   - For "get": the row object or null
   *   - For "all": an array of rows
   *   - For "run": { changes: number, lastInsertRowid: number }
   */
  async batch(
    statements: BatchStatement[],
    options?: { transaction?: boolean },
  ): Promise<unknown[]> {
    return this.send({
      method: "batch",
      statements,
      transaction: options?.transaction ?? true,
    }) as Promise<unknown[]>;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.send({ method: "close" });
    } finally {
      this.closed = true;
      await this.worker.terminate();
    }
  }
}
