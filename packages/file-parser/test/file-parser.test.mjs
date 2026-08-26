import assert from 'node:assert/strict';
import { deflateRawSync, deflateSync } from 'node:zlib';
import test from 'node:test';
import { parseLocalFile, SUPPORTED_EXTENSIONS } from '../src/index.js';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(value);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

function expectParserCode(action, code) {
  assert.throws(action, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

function rewriteFirstDeclaredSize(archive, size) {
  const output = Buffer.from(archive);
  const eocd = output.length - 22;
  const centralOffset = output.readUInt32LE(eocd + 16);
  const localOffset = output.readUInt32LE(centralOffset + 42);
  output.writeUInt32LE(size, centralOffset + 24);
  output.writeUInt32LE(size, localOffset + 22);
  return output;
}

function rewriteCentralDeclaredSizes(archive, sizes) {
  const output = Buffer.from(archive);
  const eocd = output.length - 22;
  let cursor = output.readUInt32LE(eocd + 16);
  for (const size of sizes) {
    output.writeUInt32LE(size, cursor + 24);
    const nameLength = output.readUInt16LE(cursor + 28);
    const extraLength = output.readUInt16LE(cursor + 30);
    const commentLength = output.readUInt16LE(cursor + 32);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return output;
}

function pdfWithFlateStreams(compressedStreams) {
  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  for (const compressed of compressedStreams) {
    parts.push(
      Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      compressed,
      Buffer.from('\nendstream\n', 'latin1'),
    );
  }
  parts.push(Buffer.from('%%EOF', 'latin1'));
  return Buffer.concat(parts);
}

function deterministicBytes(size) {
  const output = Buffer.allocUnsafe(size);
  let state = 0x12345678;
  for (let index = 0; index < output.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    output[index] = state & 0xff;
  }
  return output;
}

test('local parser supports text, JSON, DOCX, XLSX, and common PDF text layers', () => {
  assert.ok(SUPPORTED_EXTENSIONS.includes('.pdf'));
  assert.ok(SUPPORTED_EXTENSIONS.includes('.docx'));
  assert.ok(SUPPORTED_EXTENSIONS.includes('.xlsx'));

  const text = parseLocalFile({ name: '产品资料.txt', buffer: Buffer.from('BossAI 汽配价格 899 元') });
  assert.match(text.text, /899/);
  assert.equal(text.localOnly, true);
  assert.equal(text.cloudUpload, false);

  const json = parseLocalFile({ name: '套餐.json', buffer: Buffer.from('{"plan":"boss","price":899}') });
  assert.match(json.text, /"price": 899/);

  const docxBuffer = zip([
    ['word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>BossAI Word 汽配资料</w:t></w:r></w:p><w:p><w:r><w:t>OE 号 12345</w:t></w:r></w:p></w:body></w:document>'],
  ]);
  const docx = parseLocalFile({ name: '产品说明.docx', buffer: docxBuffer });
  assert.match(docx.text, /汽配资料/);
  assert.match(docx.text, /12345/);

  const xlsxBuffer = zip([
    ['xl/sharedStrings.xml', '<?xml version="1.0"?><sst><si><t>SKU</t></si><si><t>BRAKE-001</t></si></sst>'],
    ['xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c><v>899</v></c></row></sheetData></worksheet>'],
  ]);
  const xlsx = parseLocalFile({ name: '产品表.xlsx', buffer: xlsxBuffer });
  assert.match(xlsx.text, /BRAKE-001/);
  assert.equal(xlsx.metadata.sheetCount, 1);

  const pdfSource = '%PDF-1.4\n1 0 obj\n<< /Length 80 >>\nstream\nBT /F1 12 Tf 72 720 Td (BossAI local PDF OE 12345) Tj ET\nendstream\nendobj\n%%EOF';
  const pdf = parseLocalFile({ name: '证据.pdf', buffer: Buffer.from(pdfSource, 'latin1') });
  assert.match(pdf.text, /OE 12345/);
});

test('local parser fails closed on empty, oversized, and unsupported input', () => {
  expectParserCode(() => parseLocalFile({ name: '空.txt', buffer: Buffer.alloc(0) }), 'EMPTY_FILE');
  expectParserCode(() => parseLocalFile({ name: '旧版.doc', buffer: Buffer.from('binary') }), 'UNSUPPORTED_FILE_TYPE:.doc');
  expectParserCode(
    () => parseLocalFile({ name: '太大.txt', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) }),
    `FILE_TOO_LARGE:${8 * 1024 * 1024}`,
  );
});

test('OOXML parser blocks entry floods, ratio bombs, size mismatches, and aggregate expansion', () => {
  const tooMany = zip(Array.from({ length: 513 }, (_value, index) => [`entry-${index}.xml`, '']));
  expectParserCode(() => parseLocalFile({ name: 'too-many.docx', buffer: tooMany }), 'ZIP_TOO_MANY_ENTRIES');

  const ratioBomb = zip([['word/document.xml', Buffer.alloc(64 * 1024, 0x41)]]);
  expectParserCode(() => parseLocalFile({ name: 'ratio.docx', buffer: ratioBomb }), 'ZIP_COMPRESSION_RATIO_EXCEEDED');

  const validDocx = zip([['word/document.xml', '<w:document><w:p>safe</w:p></w:document>']]);
  const mismatch = rewriteFirstDeclaredSize(validDocx, validDocx.length + 1);
  expectParserCode(() => parseLocalFile({ name: 'mismatch.docx', buffer: mismatch }), 'ZIP_ENTRY_SIZE_MISMATCH');

  const declaredTotal = rewriteCentralDeclaredSizes(
    zip(Array.from({ length: 5 }, (_value, index) => [`xl/part-${index}.xml`, 'x'])),
    Array(5).fill(7 * 1024 * 1024),
  );
  expectParserCode(() => parseLocalFile({ name: 'aggregate.xlsx', buffer: declaredTotal }), 'ZIP_TOTAL_UNCOMPRESSED_TOO_LARGE');
});

test('PDF parser blocks compression bombs and stream floods', () => {
  const ratioBomb = pdfWithFlateStreams([deflateSync(Buffer.alloc(64 * 1024, 0x41))]);
  expectParserCode(() => parseLocalFile({ name: 'ratio.pdf', buffer: ratioBomb }), 'PDF_COMPRESSION_RATIO_EXCEEDED');

  const repeatedBlock = deterministicBytes(4 * 1024);
  const moderateRatioStream = deflateSync(Buffer.concat(Array(64).fill(repeatedBlock)));
  const cumulative = pdfWithFlateStreams(Array(65).fill(moderateRatioStream));
  expectParserCode(() => parseLocalFile({ name: 'cumulative.pdf', buffer: cumulative }), 'PDF_TOTAL_INFLATED_TOO_LARGE');

  const tooManyStreams = Buffer.from(
    `%PDF-1.4\n${Array(257).fill('<<>>\nstream\nx\nendstream').join('\n')}\n%%EOF`,
    'latin1',
  );
  expectParserCode(() => parseLocalFile({ name: 'streams.pdf', buffer: tooManyStreams }), 'PDF_TOO_MANY_STREAMS');
});
