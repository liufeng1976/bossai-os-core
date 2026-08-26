// Migrated from yj-agent-studio packages/local-rag and adopted as a BossAI OS local-only module.
// It uses deterministic BM25 + hashed vectors and never calls a cloud embedding service.
import { createHash } from "node:crypto";

const STOP_WORDS = new Set([
  "的", "了", "和", "与", "及", "或", "是", "在", "把", "被", "为", "对", "中", "里", "上", "下", "这", "那", "一个", "我们", "你们", "他们",
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with", "is", "are", "be", "this", "that"
]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cjkNgrams(text) {
  const chars = [...text.replace(/[^\u4e00-\u9fff]/g, "")];
  const grams = [];
  for (let index = 0; index < chars.length; index += 1) {
    grams.push(chars[index]);
    if (index + 1 < chars.length) grams.push(`${chars[index]}${chars[index + 1]}`);
    if (index + 2 < chars.length) grams.push(`${chars[index]}${chars[index + 1]}${chars[index + 2]}`);
  }
  return grams;
}

export function tokenize(value) {
  const text = normalize(value);
  if (!text) return [];
  const latin = text
    .replace(/[\u4e00-\u9fff]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !STOP_WORDS.has(item));
  const cjk = cjkNgrams(text).filter((item) => !STOP_WORDS.has(item));
  return [...latin, ...cjk];
}

function hashToken(token, dimensions) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % dimensions;
}

export function hashedVector(tokens, dimensions = 256) {
  const vector = new Float64Array(dimensions);
  for (const token of tokens) vector[hashToken(token, dimensions)] += 1;
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  return vector;
}

export function cosineSimilarity(left, right) {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) score += left[index] * right[index];
  return Math.max(0, Math.min(1, score));
}

export function chunkText(text, { chunkSize = 720, overlap = 120 } = {}) {
  const source = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  const paragraphs = source.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let buffer = "";

  function flush() {
    const value = buffer.trim();
    if (!value) return;
    chunks.push(value);
    buffer = value.slice(Math.max(0, value.length - overlap));
  }

  for (const paragraph of paragraphs.length ? paragraphs : [source]) {
    if (paragraph.length > chunkSize) {
      if (buffer) flush();
      for (let start = 0; start < paragraph.length; start += Math.max(1, chunkSize - overlap)) {
        chunks.push(paragraph.slice(start, start + chunkSize));
      }
      buffer = "";
      continue;
    }
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length > chunkSize) flush();
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return [...new Set(chunks.filter(Boolean))];
}

function termFrequency(tokens) {
  const frequencies = new Map();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return frequencies;
}

function bm25Score(queryTokens, document, stats) {
  const k1 = 1.35;
  const b = 0.72;
  let score = 0;
  for (const term of new Set(queryTokens)) {
    const frequency = document.tf.get(term) ?? 0;
    if (!frequency) continue;
    const documentFrequency = stats.df.get(term) ?? 0;
    const idf = Math.log(1 + (stats.count - documentFrequency + 0.5) / (documentFrequency + 0.5));
    const denominator = frequency + k1 * (1 - b + b * (document.length / stats.avgLength));
    score += idf * ((frequency * (k1 + 1)) / denominator);
  }
  return score;
}

function metadataBoost(file, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;
  let score = 0;
  const name = normalize(`${file.name ?? ""} ${file.filename ?? ""}`);
  if (name && normalizedQuery.includes(name)) score += 1;
  const tags = (file.tags ?? []).map(normalize).filter(Boolean);
  score += tags.filter((tag) => normalizedQuery.includes(tag) || tag.includes(normalizedQuery)).length * 0.75;
  return Math.min(2, score);
}

function matchedTerms(queryTokens, document) {
  const present = new Set(document.tokens);
  return [...new Set(queryTokens)]
    .filter((term) => present.has(term))
    .sort((left, right) => right.length - left.length)
    .slice(0, 12);
}

function excerptAroundMatch(text, terms, maxLength = 520) {
  const source = String(text ?? "").trim();
  if (source.length <= maxLength) return source;
  const lower = source.toLowerCase();
  const term = terms.find((item) => lower.includes(String(item).toLowerCase()));
  const matchIndex = term ? lower.indexOf(String(term).toLowerCase()) : 0;
  const start = Math.max(0, matchIndex - Math.floor(maxLength * 0.28));
  const end = Math.min(source.length, start + maxLength);
  return `${start > 0 ? "…" : ""}${source.slice(start, end).trim()}${end < source.length ? "…" : ""}`;
}

function buildDocuments(files = [], options = {}) {
  const documents = [];
  for (const file of files) {
    const text = String(file.text ?? file.content ?? file.contentPreview ?? "");
    const chunks = chunkText(text, options);
    chunks.forEach((chunk, index) => {
      const metadataText = [file.name, file.filename, ...(file.tags ?? [])].filter(Boolean).join(" ");
      const tokens = tokenize(`${metadataText} ${chunk}`);
      documents.push({
        file,
        chunk,
        chunkId: `${file.id ?? "file"}-${index + 1}`,
        index,
        tokens,
        tf: termFrequency(tokens),
        vector: hashedVector(tokens),
        length: Math.max(1, tokens.length)
      });
    });
  }
  return withCorpusStats(documents);
}

function withCorpusStats(documents) {
  const documentFrequency = new Map();
  for (const document of documents) {
    for (const token of new Set(document.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const averageLength = documents.length
    ? documents.reduce((sum, item) => sum + item.length, 0) / documents.length
    : 1;
  return {
    documents,
    stats: {
      count: Math.max(1, documents.length),
      avgLength: averageLength,
      df: documentFrequency
    }
  };
}

function rankDocuments({ query, queryTokens, index, limit, minScore, incremental }) {
  const queryVector = hashedVector(queryTokens);
  const raw = index.documents.map((document) => {
    const bm25 = bm25Score(queryTokens, document, index.stats);
    const vector = cosineSimilarity(queryVector, document.vector);
    const boost = metadataBoost(document.file, query);
    return { document, bm25, vector, boost };
  });
  const maxBm25 = Math.max(1, ...raw.map((item) => item.bm25));
  const ranked = raw.map((item) => {
    const bm25Normalized = item.bm25 / maxBm25;
    const metadataNormalized = Math.min(1, item.boost / 2);
    const score = Math.max(0, Math.min(1, bm25Normalized * 0.62 + item.vector * 0.28 + metadataNormalized * 0.1));
    const terms = matchedTerms(queryTokens, item.document);
    return { ...item, score, terms };
  }).filter((item) => item.score >= minScore && item.terms.length > 0)
    .sort((left, right) => right.score - left.score || right.terms.length - left.terms.length);

  const selected = [];
  const usedFiles = new Set();
  for (const item of ranked) {
    const fileKey = item.document.file.id ?? item.document.file.name;
    if (usedFiles.has(fileKey)) continue;
    usedFiles.add(fileKey);
    const rank = selected.length + 1;
    selected.push({
      rank,
      fileId: item.document.file.id,
      id: item.document.file.id,
      name: item.document.file.name ?? item.document.file.filename ?? "未命名资料",
      filename: item.document.file.filename ?? item.document.file.name,
      mimeType: item.document.file.mimeType ?? "text/plain",
      tags: item.document.file.tags ?? [],
      chunkId: item.document.chunkId,
      chunkIndex: item.document.index,
      score: Number(item.score.toFixed(4)),
      scorePercent: Math.round(item.score * 100),
      bm25: Number(item.bm25.toFixed(4)),
      vectorSimilarity: Number(item.vector.toFixed(4)),
      matchedTerms: item.terms,
      excerpt: excerptAroundMatch(item.document.chunk, item.terms),
      citation: `【来源${rank}：${item.document.file.name ?? item.document.file.filename ?? "资料"}#${item.document.index + 1}】`,
      retrieval: incremental
        ? "local-hybrid-bm25-hashed-vector-incremental"
        : "local-hybrid-bm25-hashed-vector",
      createdAt: item.document.file.createdAt ?? null
    });
    if (selected.length >= limit) break;
  }
  return selected;
}

export function buildLocalIndex(files = [], options = {}) {
  return buildDocuments(files, options);
}

export function searchLocalKnowledge({ query, files = [], limit = 5, minScore = 0.08, chunkSize = 720, overlap = 120 } = {}) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length || !files.length) {
    return {
      query: String(query ?? ""),
      matches: [],
      index: { files: files.length, chunks: 0 },
      algorithm: "local-hybrid-bm25-hashed-vector",
      localOnly: true
    };
  }
  const index = buildDocuments(files, { chunkSize, overlap });
  return {
    query: String(query ?? ""),
    matches: rankDocuments({ query, queryTokens, index, limit, minScore, incremental: false }),
    index: { files: files.length, chunks: index.documents.length },
    algorithm: "local-hybrid-bm25-hashed-vector",
    localOnly: true
  };
}

function fileText(file) {
  return String(file?.text ?? file?.content ?? file?.contentPreview ?? "");
}

export function knowledgeFingerprint(file) {
  return createHash("sha256")
    .update(String(file?.id ?? ""))
    .update("\u0000")
    .update(String(file?.name ?? file?.filename ?? ""))
    .update("\u0000")
    .update((file?.tags ?? []).join("\u0000"))
    .update("\u0000")
    .update(fileText(file))
    .digest("hex");
}

function encodeVector(vector) {
  const buffer = Buffer.alloc(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    buffer[index] = Math.max(0, Math.min(255, Math.round(vector[index] * 255)));
  }
  return buffer.toString("base64");
}

function decodeVector(value, dimensions = 256) {
  if (!value) return null;
  try {
    const buffer = Buffer.from(String(value), "base64");
    if (buffer.length !== dimensions) return null;
    const vector = new Float64Array(dimensions);
    let norm = 0;
    for (let index = 0; index < dimensions; index += 1) {
      vector[index] = buffer[index] / 255;
      norm += vector[index] * vector[index];
    }
    norm = Math.sqrt(norm) || 1;
    for (let index = 0; index < dimensions; index += 1) vector[index] /= norm;
    return vector;
  } catch {
    return null;
  }
}

export function buildIncrementalIndexEntry(file, options = {}) {
  const chunks = chunkText(fileText(file), options).map((chunk, index) => {
    const metadataText = [file?.name, file?.filename, ...(file?.tags ?? [])].filter(Boolean).join(" ");
    const tokens = tokenize(`${metadataText} ${chunk}`);
    return {
      chunkId: `${file?.id ?? "file"}-${index + 1}`,
      index,
      text: chunk,
      vectorBase64: encodeVector(hashedVector(tokens)),
      length: Math.max(1, tokens.length)
    };
  });
  return {
    version: 2,
    fileId: file?.id,
    fingerprint: knowledgeFingerprint(file),
    algorithm: "local-hybrid-bm25-hashed-vector",
    indexedAt: new Date().toISOString(),
    chunks
  };
}

export function incrementalIndexIsCurrent(file) {
  return Boolean(
    file?.ragIndex?.version === 2
      && file.ragIndex?.fingerprint
      && file.ragIndex.fingerprint === knowledgeFingerprint(file),
  );
}

function indexedDocuments(files = []) {
  const documents = [];
  for (const file of files) {
    const entry = incrementalIndexIsCurrent(file) ? file.ragIndex : buildIncrementalIndexEntry(file);
    for (const chunk of entry.chunks ?? []) {
      const metadataText = [file?.name, file?.filename, ...(file?.tags ?? [])].filter(Boolean).join(" ");
      const tokens = tokenize(`${metadataText} ${chunk.text ?? ""}`);
      documents.push({
        file,
        chunk: chunk.text,
        chunkId: chunk.chunkId,
        index: chunk.index,
        tokens,
        tf: termFrequency(tokens),
        vector: decodeVector(chunk.vectorBase64) ?? hashedVector(tokens),
        length: Math.max(1, chunk.length ?? tokens.length)
      });
    }
  }
  return withCorpusStats(documents);
}

export function searchIndexedKnowledge({ query, files = [], limit = 5, minScore = 0.08 } = {}) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length || !files.length) {
    return {
      query: String(query ?? ""),
      matches: [],
      index: { files: files.length, chunks: 0, incremental: true },
      algorithm: "local-hybrid-bm25-hashed-vector-incremental",
      localOnly: true
    };
  }
  const index = indexedDocuments(files);
  return {
    query: String(query ?? ""),
    matches: rankDocuments({ query, queryTokens, index, limit, minScore, incremental: true }),
    index: { files: files.length, chunks: index.documents.length, incremental: true },
    algorithm: "local-hybrid-bm25-hashed-vector-incremental",
    localOnly: true
  };
}

export function knowledgeIndexSummary(files = []) {
  const current = files.filter(incrementalIndexIsCurrent).length;
  const chunks = files.reduce((sum, file) => {
    const entry = incrementalIndexIsCurrent(file) ? file.ragIndex : buildIncrementalIndexEntry(file);
    return sum + (entry.chunks?.length ?? 0);
  }, 0);
  return {
    files: files.length,
    chunks,
    indexedFiles: current,
    pendingFiles: Math.max(0, files.length - current),
    algorithm: "local-hybrid-bm25-hashed-vector-incremental",
    localOnly: true,
    cloudUpload: false
  };
}
