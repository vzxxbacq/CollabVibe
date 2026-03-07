import type { HttpClient } from "../../src/http-client";

export const noopHttpClient: HttpClient = {
  async post() {
    return {
      status: 200,
      data: {}
    };
  }
};
