'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useLiveCamera
 * -------------
 * Granular device-capture control for the VANTA Go-Live experience.
 *
 * Camera and microphone are requested SEPARATELY so the UI can distinguish a
 * camera denial from a microphone denial and offer a targeted recovery action.
 * The hook keeps ONE stable MediaStream whose video track can be swapped in
 * place when the user flips the camera (real hardware switch, not a fake UI).
 */
export type LiveCameraErrorCode =
  | 'CAMERA_PERMISSION_DENIED'
  | 'MIC_PERMISSION_DENIED'
  | 'CAMERA_INITIALIZATION_FAILED'
  | 'MIC_INITIALIZATION_FAILED'
  | 'CAMERA_NOT_FOUND'
  | 'MIC_NOT_FOUND'
  | 'SECURE_CONTEXT_REQUIRED'
  | 'NOT_SUPPORTED'
  | 'DEVICE_IN_USE'
  | 'UNKNOWN'
  // Connection/publish failures surfaced by the Go-Live flow (not device-side,
  // but they share the same error banner + recovery UI).
  | 'LIVE_CONNECTION_FAILED'
  | 'PUBLISH_FAILED'
  | 'NETWORK_DISCONNECTED';

export interface LiveCameraError {
  code: LiveCameraErrorCode;
  message: string;
}

export type PermissionState = 'prompt' | 'granted' | 'denied' | 'unavailable';

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
  facingMode: 'user',
};

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,
};

function mapError(err: unknown, kind: 'camera' | 'mic'): LiveCameraError {
  const name = (err as DOMException)?.name;
  const secure = (err as any)?.message === 'SECURE_CONTEXT_REQUIRED' || name === 'SecurityError';
  if (secure) {
    return {
      code: 'SECURE_CONTEXT_REQUIRED',
      message: 'VANTA Live needs a secure connection (HTTPS). Open the app over https:// to enable your camera and microphone.',
    };
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return kind === 'camera'
      ? { code: 'CAMERA_PERMISSION_DENIED', message: 'Camera access was denied. Allow camera access in your browser settings, then try again.' }
      : { code: 'MIC_PERMISSION_DENIED', message: 'Microphone access was denied. Allow microphone access in your browser settings, then try again.' };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return kind === 'camera'
      ? { code: 'CAMERA_NOT_FOUND', message: 'No camera was found on this device.' }
      : { code: 'MIC_NOT_FOUND', message: 'No microphone was found on this device.' };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return { code: 'DEVICE_IN_USE', message: `${kind === 'camera' ? 'Camera' : 'Microphone'} is in use by another application. Close it and retry.` };
  }
  if (name === 'OverconstrainedError') {
    return kind === 'camera'
      ? { code: 'CAMERA_INITIALIZATION_FAILED', message: 'Your camera does not support the required resolution.' }
      : { code: 'MIC_INITIALIZATION_FAILED', message: 'Your microphone does not support the required settings.' };
  }
  if (name === 'NotSupportedError') {
    return { code: 'NOT_SUPPORTED', message: 'This browser does not support camera and microphone access.' };
  }
  return kind === 'camera'
    ? { code: 'CAMERA_INITIALIZATION_FAILED', message: (err as Error)?.message || 'Could not start the camera.' }
    : { code: 'MIC_INITIALIZATION_FAILED', message: (err as Error)?.message || 'Could not start the microphone.' };
}

export function useLiveCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [cameraPerm, setCameraPerm] = useState<PermissionState>('prompt');
  const [micPerm, setMicPerm] = useState<PermissionState>('prompt');
  const [error, setError] = useState<LiveCameraError | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const loadingRef = useRef(false);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const requireSecure = (): LiveCameraError | null => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return { code: 'NOT_SUPPORTED', message: 'This browser does not support camera and microphone access.' };
    }
    if (!window.isSecureContext) {
      return { code: 'SECURE_CONTEXT_REQUIRED', message: 'VANTA Live needs a secure connection (HTTPS). Open the app over https:// to enable your camera and microphone.' };
    }
    return null;
  };

  const fetchCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput');
      setCameras(cams);
    } catch {
      /* enumeration is optional */
    }
  }, []);

  const commitStream = useCallback((next: MediaStream) => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = next;
    setStream(new MediaStream(next.getTracks()));
    const videoTrack = next.getVideoTracks()[0];
    const audioTrack = next.getAudioTracks()[0];
    setIsVideoOn(!!videoTrack && videoTrack.readyState === 'live');
    setIsAudioOn(!!audioTrack && audioTrack.readyState === 'live');
    if (videoTrack) {
      const facing = videoTrack.getSettings?.().facingMode;
      if (facing === 'environment' || facing === 'back') setIsFrontCamera(false);
      else if (facing === 'user' || facing === 'front') setIsFrontCamera(true);
    }
    void fetchCameras();
  }, [fetchCameras]);
// -------------------------------------------------------------------------
  // Request camera (and optionally microphone) for the pre-live preview
  // -------------------------------------------------------------------------
  const requestCamera = useCallback(async (): Promise<MediaStream> => {
    const guard = requireSecure();
    if (guard) {
      setError(guard);
      setCameraPerm('unavailable');
      throw guard;
    }
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState !== 'live') {
        videoStream.getTracks().forEach((t) => t.stop());
        const e: LiveCameraError = { code: 'CAMERA_INITIALIZATION_FAILED', message: 'VANTA could not start a live camera track.' };
        setError(e);
        throw e;
      }
      setCameraPerm('granted');
      setError(null);
      return videoStream;
    } catch (err) {
      const mapped = mapError(err, 'camera');
      setError(mapped);
      if (mapped.code === 'CAMERA_PERMISSION_DENIED') setCameraPerm('denied');
      else if (mapped.code === 'CAMERA_NOT_FOUND' || mapped.code === 'NOT_SUPPORTED') setCameraPerm('unavailable');
      throw mapped;
    }
  }, []);

  const requestMicrophone = useCallback(async (): Promise<MediaStream> => {
    const guard = requireSecure();
    if (guard) {
      setError(guard);
      setMicPerm('unavailable');
      throw guard;
    }
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      const audioTrack = audioStream.getAudioTracks()[0];
      if (!audioTrack || audioTrack.readyState !== 'live') {
        audioStream.getTracks().forEach((t) => t.stop());
        const e: LiveCameraError = { code: 'MIC_INITIALIZATION_FAILED', message: 'VANTA could not start a live microphone track.' };
        setError(e);
        throw e;
      }
      setMicPerm('granted');
      setError(null);
      return audioStream;
    } catch (err) {
      const mapped = mapError(err, 'mic');
      setError(mapped);
      if (mapped.code === 'MIC_PERMISSION_DENIED') setMicPerm('denied');
      else if (mapped.code === 'MIC_NOT_FOUND' || mapped.code === 'NOT_SUPPORTED') setMicPerm('unavailable');
      throw mapped;
    }
  }, []);

  /** Acquire the preview stream: camera always; microphone only when asked. */
  const startPreview = useCallback(async (withAudio: boolean) => {
    if (loadingRef.current) return streamRef.current;
    loadingRef.current = true;
    setLoading(true);
    try {
      // Camera first so the preview appears immediately.
      const videoStream = await requestCamera();
      // Microphone is optional for preview; its error is surfaced via state and
      // the GO LIVE validation can re-request it inside the user gesture.
      if (withAudio && !streamRef.current?.getAudioTracks().length) {
        try {
          const audioStream = await requestMicrophone();
          videoStream.addTrack(audioStream.getAudioTracks()[0]);
        } catch {
          /* mic stays off — caller sees micPerm/error */
        }
      }
      commitStream(videoStream);
      return streamRef.current;
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [commitStream, requestCamera, requestMicrophone]);

  /** Add/refresh the microphone track after the user invokes it in a gesture. */
  const addMicrophone = useCallback(async (): Promise<boolean> => {
    const audioStream = await requestMicrophone();
    const track = audioStream.getAudioTracks()[0];
    if (!track) {
      audioStream.getTracks().forEach((t) => t.stop());
      return false;
    }
    // Stop an old audio track if present, then attach the new one.
    streamRef.current?.getAudioTracks().forEach((t) => {
      streamRef.current?.removeTrack(t);
      t.stop();
    });
    streamRef.current?.addTrack(track);
    if (streamRef.current) {
      setStream(new MediaStream(streamRef.current.getTracks()));
    }
    setIsAudioOn(true);
    setMicPerm('granted');
    setError(null);
    return true;
  }, [requestMicrophone]);
// -------------------------------------------------------------------------
  // Flip / mute / stop
  // -------------------------------------------------------------------------
  const flipCamera = useCallback(async (): Promise<boolean> => {
    if (!streamRef.current) return false;
    await fetchCameras();
    const currentTrack = streamRef.current.getVideoTracks()[0];
    const currentDeviceId = currentTrack?.getSettings?.().deviceId;
    const list = cameras.length ? cameras : (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'videoinput');
    if (list.length < 2) return false;
    const next = list.find((d) => d.deviceId && d.deviceId !== currentDeviceId) || list[list.length - 1];
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({
        video: { ...VIDEO_CONSTRAINTS, deviceId: { exact: next.deviceId } },
        audio: false,
      });
      const newTrack = replacement.getVideoTracks()[0];
      if (!newTrack || newTrack.readyState !== 'live') {
        replacement.getTracks().forEach((t) => t.stop());
        return false;
      }
      if (currentTrack) {
        streamRef.current.removeTrack(currentTrack);
        currentTrack.stop();
      }
      streamRef.current.addTrack(newTrack);
      setStream(new MediaStream(streamRef.current.getTracks()));
      const facing = newTrack.getSettings?.().facingMode;
      setIsFrontCamera(facing === 'user' || facing === 'front');
      return true;
    } catch {
      return false;
    }
  }, [cameras, fetchCameras]);

  const toggleVideo = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsVideoOn(track.enabled);
  }, []);

  const toggleAudio = useCallback(async () => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) {
      await addMicrophone();
      return;
    }
    track.enabled = !track.enabled;
    setIsAudioOn(track.enabled);
  }, [addMicrophone]);

  const stopAll = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setIsVideoOn(false);
    setIsAudioOn(false);
  }, []);

  const getStream = useCallback((): MediaStream | null => streamRef.current, []);

  useEffect(() => () => stopAll(), [stopAll]);

  return {
    stream,
    isVideoOn,
    isAudioOn,
    isFrontCamera,
    cameraPerm,
    micPerm,
    error,
    loading,
    cameras,
    startPreview,
    addMicrophone,
    flipCamera,
    toggleVideo,
    toggleAudio,
    stopAll,
    getStream,
    clearError: () => setError(null),
  };
}