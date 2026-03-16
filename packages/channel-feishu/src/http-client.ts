export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
  headers?: Record<string, string>;
}

export interface HttpClient {
  get<T = unknown>(url: string, headers?: Record<string, string>): Promise<HttpResponse<T>>;
  getBinary?(url: string, headers?: Record<string, string>): Promise<HttpResponse<Uint8Array>>;
  post<T = unknown>(url: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>>;
  put<T = unknown>(url: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>>;
  patch<T = unknown>(url: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>>;
  delete<T = unknown>(url: string, headers?: Record<string, string>): Promise<HttpResponse<T>>;
}
