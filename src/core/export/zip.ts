export interface ZipEntry { path: string; data: Uint8Array | string; mimeType?: string }

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function encode(value: string): Uint8Array { return new TextEncoder().encode(value); }
function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function write16(view: DataView, offset: number, value: number): void { view.setUint16(offset, value, true); }
function write32(view: DataView, offset: number, value: number): void { view.setUint32(offset, value >>> 0, true); }

/** Creates a standards-compliant ZIP with stored (uncompressed) entries. */
export function createZip(entries: readonly ZipEntry[]): Blob {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    const path = normalizeZipPath(entry.path);
    if (seen.has(path)) throw new Error(`Duplicate ZIP entry: ${path}`);
    seen.add(path);
    const name = encode(path);
    const data = typeof entry.data === 'string' ? encode(entry.data) : entry.data;
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    write32(lv, 0, 0x04034B50);
    write16(lv, 4, 20);
    write16(lv, 6, 0x0800);
    write16(lv, 8, 0);
    write16(lv, 10, dosTime(new Date()));
    write16(lv, 12, dosDate(new Date()));
    write32(lv, 14, checksum);
    write32(lv, 18, data.length);
    write32(lv, 22, data.length);
    write16(lv, 26, name.length);
    write16(lv, 28, 0);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    write32(cv, 0, 0x02014B50);
    write16(cv, 4, 0x0314);
    write16(cv, 6, 20);
    write16(cv, 8, 0x0800);
    write16(cv, 10, 0);
    write16(cv, 12, dosTime(new Date()));
    write16(cv, 14, dosDate(new Date()));
    write32(cv, 16, checksum);
    write32(cv, 20, data.length);
    write32(cv, 24, data.length);
    write16(cv, 28, name.length);
    write16(cv, 30, 0);
    write16(cv, 32, 0);
    write16(cv, 34, 0);
    write16(cv, 36, 0);
    write32(cv, 38, 0);
    write32(cv, 42, offset);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralDirectory = concat(centralParts);
  const centralOffset = offset;
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  write32(ev, 0, 0x06054B50);
  write16(ev, 4, 0);
  write16(ev, 6, 0);
  write16(ev, 8, entries.length);
  write16(ev, 10, entries.length);
  write32(ev, 12, centralDirectory.length);
  write32(ev, 16, centralOffset);
  write16(ev, 20, 0);
  return new Blob([concat([...localParts, centralDirectory, end])], { type: 'application/zip' });
}

export async function readZip(blob: Blob, limits = { maxCompressedBytes: 64 * 1024 * 1024, maxUncompressedBytes: 160 * 1024 * 1024, maxFiles: 500 }): Promise<Map<string, Uint8Array>> {
  if (blob.size > limits.maxCompressedBytes) throw new Error('ZIP package exceeds the compressed size limit.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('The selected file is not a valid ZIP archive.');
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) throw new Error('Multi-disk ZIP archives are not supported.');
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entriesCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const centralEnd = centralOffset + centralSize;
  if (entriesOnDisk !== entriesCount) throw new Error('Multi-disk ZIP archives are not supported.');
  if (entriesCount === 0xFFFF || centralSize === 0xFFFFFFFF || centralOffset === 0xFFFFFFFF) throw new Error('ZIP64 archives are not supported by this importer.');
  if (entriesCount > limits.maxFiles) throw new Error('ZIP package contains too many files.');
  if (centralEnd > eocd || centralOffset > bytes.length) throw new Error('ZIP directory is outside the archive bounds.');
  const output = new Map<string, Uint8Array>();
  let cursor = centralOffset;
  let expandedTotal = 0;
  for (let index = 0; index < entriesCount; index += 1) {
    if (cursor + 46 > centralEnd || view.getUint32(cursor, true) !== 0x02014B50) throw new Error('ZIP central directory is corrupt.');
    const madeBy = view.getUint16(cursor + 4, true);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > centralEnd) throw new Error('ZIP central directory entry exceeds its bounds.');
    let name: string;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); }
    catch { throw new Error('ZIP entry path is not valid UTF-8.'); }
    cursor = recordEnd;
    const isDirectory = name.endsWith('/');
    const normalized = normalizeZipPath(isDirectory ? name.slice(0, -1) : name);
    const platform = madeBy >>> 8;
    const mode = platform === 3 ? (externalAttributes >>> 16) & 0xF000 : 0;
    if (mode === 0xA000) throw new Error(`ZIP symbolic link entries are not supported: ${normalized}`);
    if (isDirectory) continue;
    if (output.has(normalized)) throw new Error(`ZIP contains duplicate path ${normalized}.`);
    if ((flags & 0x0001) !== 0) throw new Error(`Encrypted ZIP entries are not supported: ${normalized}`);
    if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) throw new Error('ZIP64 entries are not supported by this importer.');
    expandedTotal += uncompressedSize;
    if (expandedTotal > limits.maxUncompressedBytes) throw new Error('ZIP expands beyond the uncompressed size limit.');
    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034B50) throw new Error(`ZIP local entry for ${normalized} is corrupt.`);
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    if ((localFlags & 0x0001) !== 0 || localMethod !== method) throw new Error(`ZIP local/central entry metadata mismatch for ${normalized}.`);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataOffset > centralOffset || dataEnd > centralOffset || dataEnd > bytes.length) throw new Error(`ZIP payload for ${normalized} is outside the archive bounds.`);
    const compressed = bytes.subarray(dataOffset, dataEnd);
    let content: Uint8Array;
    if (method === 0) content = compressed.slice();
    else if (method === 8) content = await inflateRaw(compressed, uncompressedSize);
    else throw new Error(`ZIP compression method ${method} is not supported.`);
    if (content.length !== uncompressedSize || crc32(content) !== crc) throw new Error(`ZIP integrity check failed for ${normalized}.`);
    output.set(normalized, content);
  }
  if (cursor !== centralEnd) throw new Error('ZIP central directory size does not match its entries.');
  return output;
}

async function inflateRaw(data: Uint8Array, maxOutputBytes: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed ZIP entries. Use an archive with stored entries or a newer browser.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxOutputBytes) {
        await reader.cancel('ZIP entry exceeded its declared uncompressed size.');
        throw new Error('ZIP entry expands beyond its declared uncompressed size.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export function normalizeZipPath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path)) throw new Error(`Unsafe ZIP path: ${path}`);
  const parts = path.split('/');
  if (parts.some((part) => part === '..' || part === '.' || part === '')) throw new Error(`Unsafe ZIP path: ${path}`);
  return parts.join('/');
}

function dosTime(date: Date): number { return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2); }
function dosDate(date: Date): number { return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(); }
