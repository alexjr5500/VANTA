// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { repairRecordedWebmDuration } from './recordedWebmDuration';

const header = [0x1a, 0x45, 0xdf, 0xa3, 0x80];
const segment = [0x18, 0x53, 0x80, 0x67, 0xff];
const info = [0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x81, 0x00];
const blob = (bytes: number[], type = 'video/webm;codecs=vp8,opus') => new Blob([new Uint8Array(bytes)], { type });

describe('streaming WebM duration repair', () => {
  it('inserts measured duration into Info and preserves all media bytes', async () => {
    const result = await repairRecordedWebmDuration(blob([...header, ...segment, ...info, ...cluster]), 5234);
    const bytes = new Uint8Array(await result.arrayBuffer());
    expect(bytes[header.length + segment.length + 4]).toBe(0x92);
    const offset = header.length + segment.length + info.length;
    expect(Array.from(bytes.slice(offset, offset + 3))).toEqual([0x44, 0x89, 0x88]);
    expect(new DataView(bytes.buffer, offset + 3, 8).getFloat64(0)).toBe(5234);
    expect(Array.from(bytes.slice(-cluster.length))).toEqual(cluster);
    expect(await repairRecordedWebmDuration(result, 9000)).toBe(result);
  });
  it('does not rewrite indexed, non-WebM or unrecognized input', async () => {
    const indexed = blob([...header, ...segment, 0x11, 0x4d, 0x9b, 0x74, 0x80, ...info, ...cluster]);
    const invalid = blob([0, 1, 2]);
    const mp4 = blob([1, 2], 'video/mp4');
    for (const file of [indexed, invalid, mp4]) expect(await repairRecordedWebmDuration(file, 1000)).toBe(file);
  });
});
