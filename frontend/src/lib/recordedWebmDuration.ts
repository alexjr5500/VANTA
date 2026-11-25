/**
 * MediaRecorder emits streaming WebM with a finite Info element but frequently
 * no Duration. Write measured recording time into that header so the normal
 * server-side duration validation can inspect it. Never rewrite a file that
 * has a seek table (offsets would become stale), a known duration, or a
 * layout we do not understand. This is not a substitute for server validation.
 */
const INFO = 0x1549a966;
const SEGMENT = 0x18538067;
const SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const SEEK_HEAD = 0x114d9b74;
const CLUSTER = 0x1f43b675;

type Element = { id: number; offset: number; sizeOffset: number; data: number; end: number; unknown: boolean };

function vint(bytes: Uint8Array, pos: number, id = false) {
  const first = bytes[pos];
  if (!first) return null;
  let width = 1;
  let marker = 128;
  while (!(first & marker)) { width++; marker >>= 1; }
  if (pos + width > bytes.length || (id && width > 4)) return null;
  let value = id ? first : first & (marker - 1);
  let unknown = !id && value === marker - 1;
  for (let i = 1; i < width; i++) {
    value = value * 256 + bytes[pos + i];
    unknown = unknown && bytes[pos + i] === 255;
  }
  if (!unknown && !Number.isSafeInteger(value)) return null;
  return { value, width, unknown };
}

function element(bytes: Uint8Array, offset: number): Element | null {
  const id = vint(bytes, offset, true);
  if (!id) return null;
  const sizeOffset = offset + id.width;
  const size = vint(bytes, sizeOffset);
  if (!size) return null;
  const data = sizeOffset + size.width;
  const end = size.unknown ? bytes.length : data + size.value;
  if (end < data || end > bytes.length) return null;
  return { id: id.value, offset, sizeOffset, data, end, unknown: size.unknown };
}

function sizeBytes(size: number): Uint8Array {
  let width = 1;
  while (size >= 2 ** (7 * width) - 1) width++;
  const bytes = new Uint8Array(width);
  for (let i = width - 1; i >= 0; i--) { bytes[i] = size % 256; size = Math.floor(size / 256); }
  bytes[0] |= 1 << (8 - width);
  return bytes;
}

export async function repairRecordedWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!/^video\/webm(?:;|$)/i.test(blob.type) || !Number.isFinite(durationMs) || durationMs <= 0) return blob;
  // Bound inspection to the header; no entire-file copy for large recordings.
  const bytes = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  const header = element(bytes, 0);
  if (!header || header.id !== 0x1a45dfa3 || header.unknown) return blob;
  const segment = element(bytes, header.end);
  // Streaming MediaRecorder files have unknown-length segments. Restrict the
  // repair to those so declared sizes and seek-table offsets cannot be broken.
  if (!segment || segment.id !== SEGMENT || !segment.unknown) return blob;
  let info: Element | null = null;
  for (let offset = segment.data; offset < bytes.length;) {
    const id = vint(bytes, offset, true);
    if (!id || id.value === CLUSTER) break;
    if (id.value === SEEK_HEAD) return blob;
    const child = element(bytes, offset);
    if (!child || child.unknown) break;
    if (child.id === INFO) info = child;
    offset = child.end;
  }
  if (!info) return blob;
  let scale = 1_000_000;
  let existing: Element | null = null;
  for (let offset = info.data; offset < info.end;) {
    const child = element(bytes, offset);
    if (!child || child.unknown || child.end > info.end) return blob;
    if (child.id === DURATION) existing = child;
    if (child.id === SCALE) {
      scale = 0;
      for (let i = child.data; i < child.end; i++) scale = scale * 256 + bytes[i];
    }
    offset = child.end;
  }
  if (!Number.isSafeInteger(scale) || scale <= 0) return blob;
  const value = durationMs * 1_000_000 / scale;
  if (existing) {
    const length = existing.end - existing.data;
    if (length !== 4 && length !== 8) return blob;
    const old = new DataView(bytes.buffer, existing.data, length);
    const previous = length === 4 ? old.getFloat32(0) : old.getFloat64(0);
    if (Number.isFinite(previous) && previous > 0) return blob;
    const replacement = new ArrayBuffer(length);
    if (length === 4) new DataView(replacement).setFloat32(0, value);
    else new DataView(replacement).setFloat64(0, value);
    return new Blob([blob.slice(0, existing.data), replacement, blob.slice(existing.end)], { type: blob.type });
  }
  const duration = new Uint8Array(11);
  duration.set([0x44, 0x89, 0x88]);
  new DataView(duration.buffer).setFloat64(3, value);
  const size = sizeBytes(info.end - info.data + duration.length);
  return new Blob([blob.slice(0, info.sizeOffset), new Uint8Array(size).buffer, blob.slice(info.data, info.end), duration.buffer, blob.slice(info.end)], { type: blob.type });
}
