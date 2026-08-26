// Migrated from yj-agent-studio packages/file-parser and adopted as a BossAI OS local-only module.
// The parser never uploads source bytes and fails closed on archive/PDF resource abuse.
import { extname } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACTED_TEXT = 2_000_000;
const MAX_ZIP_ENTRIES = 512;
const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 250;
const MAX_PDF_STREAMS = 256;
const MAX_PDF_STREAM_BYTES = 8 * 1024 * 1024;
const MAX_PDF_TOTAL_INFLATED_BYTES = 16 * 1024 * 1024;

function parserError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function compressionRatioExceeded(compressedSize, uncompressedSize) {
  if (!uncompressedSize) return false;
  if (!compressedSize) return true;
  return uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_TEXT);
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw parserError("ZIP_END_NOT_FOUND");
}

function unzipEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw parserError("ZIP_MULTIDISK_NOT_SUPPORTED");
  }
  if (totalEntries > MAX_ZIP_ENTRIES) throw parserError("ZIP_TOO_MANY_ENTRIES");
  if (centralOffset > eocd || centralSize > eocd - centralOffset) {
    throw parserError("ZIP_INVALID_CENTRAL_DIRECTORY");
  }

  const entries = [];
  let declaredTotal = 0;
  let cursor = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw parserError("ZIP_INVALID_CENTRAL_DIRECTORY");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nextCursor = cursor + 46 + nameLength + extraLength + commentLength;

    if (nextCursor > eocd || nextCursor > centralOffset + centralSize) {
      throw parserError("ZIP_INVALID_CENTRAL_DIRECTORY");
    }
    if (flags & 0x1) throw parserError("ZIP_ENCRYPTED_NOT_SUPPORTED");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw parserError("ZIP64_NOT_SUPPORTED");
    }
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw parserError("ZIP_ENTRY_TOO_LARGE");

    declaredTotal += uncompressedSize;
    if (declaredTotal > MAX_ZIP_TOTAL_BYTES) throw parserError("ZIP_TOTAL_UNCOMPRESSED_TOO_LARGE");

    entries.push({
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
      name: buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8")
    });
    cursor = nextCursor;
  }

  if (cursor !== centralOffset + centralSize) throw parserError("ZIP_INVALID_CENTRAL_DIRECTORY");

  const files = new Map();
  let extractedTotal = 0;

  for (const entry of entries) {
    const { flags, method, compressedSize, uncompressedSize, localOffset, name } = entry;
    if (localOffset + 30 > centralOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw parserError("ZIP_INVALID_LOCAL_HEADER");
    }
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;

    if (localFlags !== flags || localMethod !== method || start > centralOffset || end > centralOffset) {
      throw parserError("ZIP_HEADER_MISMATCH");
    }
    if (!(flags & 0x8) && (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)) {
      throw parserError("ZIP_HEADER_MISMATCH");
    }
    if (method === 0 && compressedSize !== uncompressedSize) throw parserError("ZIP_ENTRY_SIZE_MISMATCH");
    if (method !== 0 && method !== 8) continue;
    if (compressionRatioExceeded(compressedSize, uncompressedSize)) {
      throw parserError("ZIP_COMPRESSION_RATIO_EXCEEDED");
    }

    const compressed = buffer.subarray(start, end);
    let data;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else {
      try {
        data = inflateRawSync(compressed, { maxOutputLength: Math.max(1, uncompressedSize) });
      } catch (error) {
        if (error?.code === "ERR_BUFFER_TOO_LARGE") throw parserError("ZIP_ENTRY_SIZE_MISMATCH");
        throw parserError("ZIP_DECOMPRESSION_FAILED");
      }
    }
    if (data.length !== uncompressedSize) throw parserError("ZIP_ENTRY_SIZE_MISMATCH");

    extractedTotal += data.length;
    if (extractedTotal > MAX_ZIP_TOTAL_BYTES) throw parserError("ZIP_TOTAL_UNCOMPRESSED_TOO_LARGE");
    files.set(name, data);
  }
  return files;
}

function extractDocx(buffer) {
  const entries = unzipEntries(buffer);
  const document = entries.get("word/document.xml");
  if (!document) throw parserError("DOCX_DOCUMENT_XML_NOT_FOUND");
  const xml = document.toString("utf8")
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<[^>]+>/g, "");
  const text = cleanText(decodeXml(xml));
  return {
    text,
    parser: "docx-openxml-local",
    metadata: { entryCount: entries.size },
    warnings: text ? [] : ["Word 文件没有提取到可检索文字。"]
  };
}

function sharedStrings(entries) {
  const xml = entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const values = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const text = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXml(item[1])).join("");
    values.push(text);
  }
  return values;
}

function extractXlsx(buffer) {
  const entries = unzipEntries(buffer);
  const strings = sharedStrings(entries);
  const sheets = [...entries.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  const sections = [];

  for (const [name, data] of sheets) {
    const xml = data.toString("utf8");
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1];
        const body = cellMatch[2];
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
        let value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        if (type === "s") value = strings[Number(value)] ?? value;
        if (type === "inlineStr") {
          value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXml(item[1])).join("");
        }
        cells.push(decodeXml(value));
      }
      if (cells.some((cell) => String(cell).trim())) rows.push(cells.join("\t"));
    }
    sections.push(`【工作表 ${name.split("/").pop()}】\n${rows.join("\n")}`);
  }

  const text = cleanText(sections.join("\n\n"));
  return {
    text,
    parser: "xlsx-openxml-local",
    metadata: { sheetCount: sheets.length, sharedStringCount: strings.length },
    warnings: text ? [] : ["Excel 文件没有提取到可检索单元格。"]
  };
}

function decodePdfLiteral(value) {
  return String(value ?? "")
    .replace(/\\([nrtbf()\\])/g, (_match, char) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }[char]))
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
    .replace(/\\\r?\n/g, "");
}

function decodePdfHex(value) {
  const hex = String(value ?? "").replace(/\s+/g, "");
  if (!hex) return "";
  const padded = hex.length % 2 ? `${hex}0` : hex;
  const data = Buffer.from(padded, "hex");
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    let output = "";
    for (let index = 2; index + 1 < data.length; index += 2) output += String.fromCharCode(data.readUInt16BE(index));
    return output;
  }
  return data.toString("latin1");
}

function extractPdfTextOperators(value) {
  const blocks = String(value ?? "").match(/BT[\s\S]*?ET/g) ?? [];
  const lines = [];
  for (const block of blocks) {
    for (const item of block.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g)) lines.push(decodePdfLiteral(item[1]));
    for (const item of block.matchAll(/<([0-9a-fA-F\s]+)>\s*Tj/g)) lines.push(decodePdfHex(item[1]));
    for (const array of block.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      const parts = [];
      for (const item of array[1].matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9a-fA-F\s]+)>/g)) {
        parts.push(item[1] != null ? decodePdfLiteral(item[1]) : decodePdfHex(item[2]));
      }
      if (parts.length) lines.push(parts.join(""));
    }
  }
  return lines.join("\n");
}

function extractPdf(buffer) {
  const source = buffer.toString("latin1");
  const texts = [extractPdfTextOperators(source)];
  let streamCount = 0;
  let inflatedCount = 0;
  let totalInflatedBytes = 0;
  for (const match of source.matchAll(/(<<[\s\S]*?>>)\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    streamCount += 1;
    if (streamCount > MAX_PDF_STREAMS) throw parserError("PDF_TOO_MANY_STREAMS");
    const dictionary = match[1];
    const raw = Buffer.from(match[2], "latin1");
    let decoded = raw;
    if (/\/FlateDecode\b/.test(dictionary)) {
      const remainingBudget = MAX_PDF_TOTAL_INFLATED_BYTES - totalInflatedBytes;
      if (remainingBudget <= 0) throw parserError("PDF_TOTAL_INFLATED_TOO_LARGE");
      const outputLimit = Math.min(MAX_PDF_STREAM_BYTES, remainingBudget);
      try {
        decoded = inflateSync(raw, { maxOutputLength: outputLimit });
        inflatedCount += 1;
      } catch (error) {
        if (error?.code === "ERR_BUFFER_TOO_LARGE") {
          if (remainingBudget < MAX_PDF_STREAM_BYTES) throw parserError("PDF_TOTAL_INFLATED_TOO_LARGE");
          throw parserError("PDF_STREAM_TOO_LARGE");
        }
        continue;
      }
      if (compressionRatioExceeded(raw.length, decoded.length)) {
        throw parserError("PDF_COMPRESSION_RATIO_EXCEEDED");
      }
      totalInflatedBytes += decoded.length;
      if (totalInflatedBytes > MAX_PDF_TOTAL_INFLATED_BYTES) throw parserError("PDF_TOTAL_INFLATED_TOO_LARGE");
    }
    texts.push(extractPdfTextOperators(decoded.toString("latin1")));
  }
  const text = cleanText(texts.join("\n"));
  const warnings = [];
  if (!text) warnings.push("PDF 没有提取到文字，可能是扫描件、加密文件或使用了复杂字体映射。请改用可复制文字的 PDF，或粘贴文本内容。");
  else warnings.push("PDF 本地解析支持常见文本层；复杂字体映射可能导致部分文字缺失。请抽查引用内容。");
  return {
    text,
    parser: "pdf-text-layer-local",
    metadata: { streamCount, inflatedCount, totalInflatedBytes },
    warnings
  };
}

function extractPlain(buffer, extension) {
  let text = buffer.toString("utf8");
  if (extension === ".json") {
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep original */ }
  }
  if (extension === ".html" || extension === ".htm") {
    text = decodeXml(text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  }
  return { text: cleanText(text), parser: "utf8-text-local", metadata: {}, warnings: [] };
}

export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".csv", ".json", ".html", ".htm", ".docx", ".xlsx", ".pdf"];

function mimeForExtension(extension) {
  return {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".html": "text/html",
    ".htm": "text/html",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pdf": "application/pdf"
  }[extension] ?? "application/octet-stream";
}

export function parseLocalFile({ name, mimeType = "", buffer }) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  if (!source.length) throw parserError("EMPTY_FILE");
  if (source.length > MAX_FILE_BYTES) throw parserError(`FILE_TOO_LARGE:${MAX_FILE_BYTES}`);
  const extension = extname(String(name ?? "")).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(extension)) throw parserError(`UNSUPPORTED_FILE_TYPE:${extension || mimeType || "unknown"}`);

  let parsed;
  if ([".txt", ".md", ".csv", ".json", ".html", ".htm"].includes(extension)) parsed = extractPlain(source, extension);
  else if (extension === ".docx") parsed = extractDocx(source);
  else if (extension === ".xlsx") parsed = extractXlsx(source);
  else if (extension === ".pdf") parsed = extractPdf(source);

  return {
    ...parsed,
    name: String(name || `upload${extension}`),
    extension,
    mimeType: mimeType || mimeForExtension(extension),
    originalSize: source.length,
    textLength: parsed.text.length,
    localOnly: true,
    cloudUpload: false,
    supported: true
  };
}
