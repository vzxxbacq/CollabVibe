import type { HttpClient } from "../../src/http-client";

export const noopHttpClient = {
  get: async () => ({ status: 200, data: {} }),
  post: async () => ({ status: 200, data: {} }),
  patch: async () => ({ status: 200, data: {} }),
  delete: async () => ({ status: 200, data: {} }),
} as unknown as HttpClient;
