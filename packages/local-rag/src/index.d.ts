export interface KnowledgeFile {
  id?: string;
  name?: string;
  filename?: string;
  mimeType?: string;
  tags?: string[];
  text?: string;
  content?: string;
  contentPreview?: string;
  createdAt?: string | null;
  ragIndex?: IncrementalIndexEntry;
}

export interface IndexedChunk {
  chunkId: string;
  index: number;
  text: string;
  vectorBase64: string;
  length: number;
}

export interface IncrementalIndexEntry {
  version: 2;
  fileId?: string;
  fingerprint: string;
  algorithm: 'local-hybrid-bm25-hashed-vector';
  indexedAt: string;
  chunks: IndexedChunk[];
}

export interface KnowledgeMatch {
  rank: number;
  fileId?: string;
  id?: string;
  name: string;
  filename?: string;
  mimeType: string;
  tags: string[];
  chunkId: string;
  chunkIndex: number;
  score: number;
  scorePercent: number;
  bm25: number;
  vectorSimilarity: number;
  matchedTerms: string[];
  excerpt: string;
  citation: string;
  retrieval: string;
  createdAt: string | null;
}

export interface KnowledgeSearchResult {
  query: string;
  matches: KnowledgeMatch[];
  index: { files: number; chunks: number; incremental?: boolean };
  algorithm: string;
  localOnly: true;
}

export function tokenize(value: unknown): string[];
export function hashedVector(tokens: string[], dimensions?: number): Float64Array;
export function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number;
export function chunkText(text: string, options?: { chunkSize?: number; overlap?: number }): string[];
export function buildLocalIndex(files?: KnowledgeFile[], options?: { chunkSize?: number; overlap?: number }): unknown;
export function searchLocalKnowledge(input?: {
  query?: string;
  files?: KnowledgeFile[];
  limit?: number;
  minScore?: number;
  chunkSize?: number;
  overlap?: number;
}): KnowledgeSearchResult;
export function knowledgeFingerprint(file: KnowledgeFile): string;
export function buildIncrementalIndexEntry(
  file: KnowledgeFile,
  options?: { chunkSize?: number; overlap?: number },
): IncrementalIndexEntry;
export function incrementalIndexIsCurrent(file: KnowledgeFile): boolean;
export function searchIndexedKnowledge(input?: {
  query?: string;
  files?: KnowledgeFile[];
  limit?: number;
  minScore?: number;
}): KnowledgeSearchResult;
export function knowledgeIndexSummary(files?: KnowledgeFile[]): {
  files: number;
  chunks: number;
  indexedFiles: number;
  pendingFiles: number;
  algorithm: string;
  localOnly: true;
  cloudUpload: false;
};
