import type { HttpClient, HttpResponse } from "./http-client";
import { createLogger } from "../../logging";

export class FeishuHttpError extends Error {
  readonly status: number;

  readonly code?: number;

  readonly details?: unknown;

  constructor(message: string, status: number, code?: number, details?: unknown) {
    super(message);
    this.name = "FeishuHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface FetchHttpClientOptions {
  appId: string;
  appSecret: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  now?: () => number;
}

interface TokenResponse {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

export class FetchHttpClient implements HttpClient {
  private readonly log = createLogger("feishu-http");

  private readonly appId: string;

  private readonly appSecret: string;

  private readonly apiBaseUrl: string;

  private readonly timeoutMs: number;

  private readonly fetcher: typeof fetch;

  private readonly now: () => number;

  private token: string | null = null;

  private tokenExpiresAt = 0;

  private pendingRefresh: Promise<void> | null = null;

  constructor(options: FetchHttpClientOptions) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.apiBaseUrl = options.apiBaseUrl ?? "https://open.feishu.cn/open-apis";
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  async get<T = unknown>(url: string, headers: Record<string, string> = {}): Promise<HttpResponse<T>> {
    return this.request<T>("GET", url, null, headers);
  }

  async getBinary(url: string, headers: Record<string, string> = {}): Promise<HttpResponse<Uint8Array>> {
    await this.ensureToken();
    const response = await this.fetchWithTimeout(url, {
      method: "GET",
      headers: {
        ...headers,
        Authorization: `Bearer ${this.token}`
      }
    }, "GET", url);
    const arrayBuffer = await response.arrayBuffer();
    if (!response.ok) {
      throw new FeishuHttpError(`feishu request failed (${response.status})`, response.status);
    }
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    return {
      status: response.status,
      data: new Uint8Array(arrayBuffer),
      headers: responseHeaders
    };
  }

  async post<T = unknown>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<HttpResponse<T>> {
    return this.request<T>("POST", url, body, headers);
  }

  async put<T = unknown>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<HttpResponse<T>> {
    return this.request<T>("PUT", url, body, headers);
  }

  async patch<T = unknown>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<HttpResponse<T>> {
    return this.request<T>("PATCH", url, body, headers);
  }

  async delete<T = unknown>(url: string, headers: Record<string, string> = {}): Promise<HttpResponse<T>> {
    return this.request<T>("DELETE", url, null, headers);
  }

  private async request<T = unknown>(method: string, url: string, body: unknown, headers: Record<string, string> = {}): Promise<HttpResponse<T>> {
    await this.ensureToken();
    const fetchInit: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
        Authorization: `Bearer ${this.token}`
      }
    };
    if (body !== null && body !== undefined) {
      fetchInit.body = JSON.stringify(body);
    }
    const response = await this.fetchWithTimeout(url, fetchInit, method, url);
    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new FeishuHttpError(
        String(data.msg ?? `feishu request failed (${response.status})`),
        response.status,
        typeof data.code === "number" ? data.code : undefined,
        data
      );
    }

    if (typeof data.code === "number" && data.code !== 0) {
      throw new FeishuHttpError(
        String(data.msg ?? "feishu business error"),
        response.status,
        data.code,
        data
      );
    }

    return {
      status: response.status,
      data: data as T
    };
  }

  private async ensureToken(): Promise<void> {
    if (this.token && this.now() < this.tokenExpiresAt - 60_000) {
      return;
    }
    if (!this.pendingRefresh) {
      this.pendingRefresh = this.refreshToken().finally(() => {
        this.pendingRefresh = null;
      });
    }
    await this.pendingRefresh;
  }

  private async refreshToken(): Promise<void> {
    const tokenUrl = `${this.apiBaseUrl}/auth/v3/tenant_access_token/internal`;
    const response = await this.fetchWithTimeout(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret
      })
    }, "POST", "auth/v3/tenant_access_token/internal");
    const payload = (await response.json()) as TokenResponse;
    if (!response.ok || payload.code !== 0 || !payload.tenant_access_token || !payload.expire) {
      throw new FeishuHttpError(
        String(payload.msg ?? "failed to fetch tenant_access_token"),
        response.status,
        payload.code,
        payload
      );
    }

    this.token = payload.tenant_access_token;
    this.tokenExpiresAt = this.now() + payload.expire * 1000;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, method: string, requestName: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`timeout after ${this.timeoutMs}ms`)), this.timeoutMs);
    try {
      return await this.fetcher(url, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = controller.signal.aborted;
      this.log.warn({
        method,
        requestName,
        timeoutMs: this.timeoutMs,
        err: message
      }, timedOut ? "feishu request timed out" : "feishu request failed");
      throw new FeishuHttpError(
        timedOut
          ? `feishu request timeout after ${this.timeoutMs}ms for ${method} ${requestName}`
          : `feishu request failed for ${method} ${requestName}: ${message}`,
        408
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
