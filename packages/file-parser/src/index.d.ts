export const SUPPORTED_EXTENSIONS: readonly string[];

export interface LocalFileParseInput {
  name: string;
  mimeType?: string;
  buffer: Buffer | Uint8Array | ArrayBuffer;
}

export interface LocalFileParseResult {
  text: string;
  parser: string;
  metadata: Record<string, number | string | boolean | null>;
  warnings: string[];
  name: string;
  extension: string;
  mimeType: string;
  originalSize: number;
  textLength: number;
  localOnly: true;
  cloudUpload: false;
  supported: true;
}

export interface LocalFileParserError extends Error {
  code: string;
}

export function parseLocalFile(input: LocalFileParseInput): LocalFileParseResult;
