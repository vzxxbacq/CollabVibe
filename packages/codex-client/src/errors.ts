export class CodexApiError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "CodexApiError";
    this.code = code;
  }
}

export class CodexClientStateError extends Error {}
