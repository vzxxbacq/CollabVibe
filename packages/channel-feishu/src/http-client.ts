export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
}

export interface HttpClient {
  post<T = unknown>(url: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>>;
}
