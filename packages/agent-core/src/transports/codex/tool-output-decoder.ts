import { Buffer } from "node:buffer";

export type ToolOutputFormat = "text" | "binary" | "mixed";

export interface DecodedToolOutput {
  text: string;
  format: ToolOutputFormat;
  byteLength: number;
}

const ANSI_PATTERN = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
const CONTROL_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const REPLACEMENT_CHAR = "\uFFFD";

export function decodeToolOutput(rawChunk: string): DecodedToolOutput {
  if (!rawChunk) {
    return { text: "", format: "text", byteLength: 0 };
  }

  const rawText = sanitizeText(rawChunk);
  const rawTextLooksNatural = looksLikeNaturalText(rawChunk);
  const base64Bytes = decodeStrictBase64(rawChunk);

  if (base64Bytes && !rawTextLooksNatural) {
    return renderBytes(base64Bytes);
  }

  return {
    text: rawText,
    format: "text",
    byteLength: Buffer.byteLength(rawChunk, "utf8")
  };
}

function renderBytes(bytes: Buffer): DecodedToolOutput {
  const mime = sniffMime(bytes);
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const nulCount = countByte(bytes, 0x00);
  const replacementCount = countOccurrences(decoded, REPLACEMENT_CHAR);
  const controlCount = countBinaryControls(bytes);
  const isText = !mime
    && nulCount === 0
    && controlCount / Math.max(bytes.length, 1) <= 0.02
    && replacementCount / Math.max(decoded.length, 1) <= 0.01;

  if (isText) {
    return {
      text: sanitizeText(decoded),
      format: "text",
      byteLength: bytes.length
    };
  }

  const textPreview = extractTextPreview(decoded);
  if (textPreview) {
    return {
      text: `${textPreview}\n${binaryPlaceholder(bytes.length, mime)}`,
      format: "mixed",
      byteLength: bytes.length
    };
  }

  return {
    text: binaryPlaceholder(bytes.length, mime),
    format: "binary",
    byteLength: bytes.length
  };
}

function sanitizeText(value: string): string {
  return value.replace(ANSI_PATTERN, "").replace(CONTROL_PATTERN, "");
}

function looksLikeNaturalText(value: string): boolean {
  if (!value) {
    return false;
  }
  if (/[^A-Za-z0-9+/=\r\n]/.test(value)) {
    return true;
  }
  if (/\s/.test(value) && /[A-Za-z\u4E00-\u9FFF]/.test(value)) {
    return true;
  }
  if (/[\u4E00-\u9FFF]/.test(value)) {
    return true;
  }
  if (/[_-]/.test(value)) {
    return true;
  }
  return value.length < 16;
}

function decodeStrictBase64(value: string): Buffer | null {
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length < 16 || normalized.length % 4 !== 0) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return null;
  }

  try {
    const bytes = Buffer.from(normalized, "base64");
    if (bytes.length === 0) {
      return null;
    }
    return bytes.toString("base64") === normalized ? bytes : null;
  } catch {
    return null;
  }
}

function countByte(bytes: Buffer, target: number): number {
  let count = 0;
  for (const byte of bytes) {
    if (byte === target) count += 1;
  }
  return count;
}

function countBinaryControls(bytes: Buffer): number {
  let count = 0;
  for (const byte of bytes) {
    const isAllowedWhitespace = byte === 0x09 || byte === 0x0A || byte === 0x0D;
    if (!isAllowedWhitespace && ((byte >= 0x00 && byte <= 0x1F) || byte === 0x7F)) {
      count += 1;
    }
  }
  return count;
}

function countOccurrences(value: string, pattern: string): number {
  if (!value || !pattern) return 0;
  return value.split(pattern).length - 1;
}

function extractTextPreview(decoded: string): string {
  const segments = sanitizeText(decoded)
    .split(/[\uFFFD\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/)
    .map((segment) => segment.trim())
    .filter((segment) => /[A-Za-z0-9\u4E00-\u9FFF]/.test(segment) && segment.length >= 8);

  if (segments.length === 0) {
    return "";
  }

  return segments.slice(0, 2).join("\n...").slice(0, 240).trim();
}

function binaryPlaceholder(byteLength: number, mime?: string): string {
  return mime
    ? `[binary output omitted: ${mime}, ${byteLength} bytes]`
    : `[binary output omitted: ${byteLength} bytes]`;
}

function sniffMime(bytes: Buffer): string | undefined {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
    && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF87a") {
    return "image/gif";
  }
  if (bytes.length >= 6 && Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF89a") {
    return "image/gif";
  }
  if (bytes.length >= 4 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "%PDF") {
    return "application/pdf";
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "application/zip";
  }
  if (bytes.length >= 4 && bytes[0] === 0x7F && bytes[1] === 0x45 && bytes[2] === 0x4C && bytes[3] === 0x46) {
    return "application/x-elf";
  }
  return undefined;
}
