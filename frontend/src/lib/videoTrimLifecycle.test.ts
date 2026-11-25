import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trimVideoSegment } from './videoTrim';

const stopTrack = vi.fn();
const startRecorder = vi.fn();
let activeRecorder: FakeRecorder | undefined;

class FakeRecorder extends EventTarget {
  static isTypeSupported() { return true; }
  state = 'inactive';
  mimeType = 'video/webm';
  constructor() { super(); activeRecorder = this; }
  start() { this.state = 'recording'; startRecorder(); }
  stop() {
    this.state = 'inactive';
    const event = Object.assign(new Event('dataavailable'), {data: new Blob(['synthetic video'])});
    this.dispatchEvent(event);
    this.dispatchEvent(new Event('stop'));
  }
}
class FakeVideo extends EventTarget {
  duration = 8;
  currentTime = 0;
  seeking = false;
  ended = false;
  volume = 1;
  muted = false;
  pause = vi.fn();
  play = vi.fn(async () => undefined);
  captureStream() {
    const track = {stop: stopTrack};
    return {getTracks: () => [track], getVideoTracks: () => [track]};
  }
}
const asVideo = (video: FakeVideo) => video as unknown as HTMLVideoElement;

describe('shared Status/Reel trim lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    activeRecorder = undefined;
    vi.stubGlobal('window', {setTimeout, requestAnimationFrame: () => 1});
    vi.stubGlobal('document', {});
    vi.stubGlobal('HTMLVideoElement', FakeVideo);
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('does not start capture if already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(trimVideoSegment({video: asVideo(new FakeVideo()), start: 0, end: 2, signal: controller.signal})).rejects.toMatchObject({name:'AbortError'});
    expect(activeRecorder).toBeUndefined();
  });
  it('cancels promptly while seeking, and cannot start recording later', async () => {
    const video = new FakeVideo();
    const controller = new AbortController();
    const result = trimVideoSegment({video: asVideo(video), start: 2, end: 4, signal: controller.signal});
    const assertion = expect(result).rejects.toMatchObject({name:'AbortError'});
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(1000);
    expect(startRecorder).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
  it('stops at the chosen endpoint without waiting for an animation frame', async () => {
    const video = new FakeVideo();
    const result = trimVideoSegment({video: asVideo(video), start: 0, end: 2});
    await vi.advanceTimersByTimeAsync(0);
    expect(startRecorder).toHaveBeenCalledTimes(1);
    video.currentTime = 2;
    video.dispatchEvent(new Event('timeupdate'));
    expect((await result).size).toBeGreaterThan(0);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
  it('rejects early recorder termination instead of uploading a partial clip', async () => {
    const video = new FakeVideo();
    const result = trimVideoSegment({video: asVideo(video), start: 0, end: 4});
    const assertion = expect(result).rejects.toThrow('before the selected range');
    await vi.advanceTimersByTimeAsync(0);
    video.currentTime = 1;
    activeRecorder?.stop();
    await assertion;
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
});
