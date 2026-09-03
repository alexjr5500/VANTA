'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface MediaDeviceInfo {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

interface MediaDeviceState {
  video: boolean;
  audio: boolean;
  videoDeviceId: string | null;
  audioDeviceId: string | null;
}

interface UseMediaDevicesReturn {
  stream: MediaStream | null;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  isVideoOn: boolean;
  isAudioOn: boolean;
  error: string | null;
  permissionState: 'prompt' | 'granted' | 'denied' | 'unavailable';
  isLoading: boolean;
  startMedia: () => Promise<MediaStream>;
  stopMedia: () => void;
  toggleVideo: () => Promise<void>;
  toggleAudio: () => Promise<void>;
  switchCamera: (deviceId: string) => Promise<void>;
  switchMicrophone: (deviceId: string) => Promise<void>;
  getMediaState: () => MediaDeviceState;
}

export function useMediaDevices(): UseMediaDevicesReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isAudioOn, setIsAudioOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'unavailable'>('prompt');
  const [isLoading, setIsLoading] = useState(false);
  
  const currentVideoDeviceId = useRef<string | null>(null);
  const currentAudioDeviceId = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startPromiseRef = useRef<Promise<MediaStream> | null>(null);

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const vids: MediaDeviceInfo[] = [];
      const auds: MediaDeviceInfo[] = [];
      
      devices.forEach(device => {
        if (device.kind === 'videoinput') {
          vids.push({ deviceId: device.deviceId, label: device.label || `Camera ${vids.length + 1}`, kind: device.kind });
        } else if (device.kind === 'audioinput') {
          auds.push({ deviceId: device.deviceId, label: device.label || `Microphone ${auds.length + 1}`, kind: device.kind });
        }
      });
      
      setVideoDevices(vids);
      setAudioDevices(auds);
    } catch (err) {
      console.error('Error enumerating devices:', err);
    }
  }, []);

  const startMedia = useCallback((): Promise<MediaStream> => {
    const current = streamRef.current;
    if (current && current.getVideoTracks().some(track => track.readyState === 'live') && current.getAudioTracks().some(track => track.readyState === 'live')) {
      return Promise.resolve(current);
    }
    if (startPromiseRef.current) return startPromiseRef.current;

    setIsLoading(true);
    setError(null);

    const request = (async () => {
      try {
      // Guard against SSR / non-browser execution. Browser-only media APIs
      // (navigator.mediaDevices, MediaStream, MediaStreamTrack) must never run
      // during server rendering.
      if (typeof navigator === 'undefined' || typeof window === 'undefined') {
        throw new DOMException('Media devices are only available in the browser.', 'NotSupportedError');
      }

      // getUserMedia only exists in a secure context (HTTPS or localhost).
      // On a plain-HTTP LAN address (e.g. http://10.0.0.5:3000 opened on a
      // phone) navigator.mediaDevices is undefined, so surface a precise,
      // actionable message instead of a generic "not supported" error.
      if (!window.isSecureContext) {
        throw new DOMException('SECURE_CONTEXT_REQUIRED', 'SecurityError');
      }

      // Check if mediaDevices is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support camera and microphone access');
      }

      // Request permissions and get stream
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
      });

      // Stop any existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      streamRef.current = mediaStream;
      const videoTrack = mediaStream.getVideoTracks()[0];
      const audioTrack = mediaStream.getAudioTracks()[0];
      if (!videoTrack || videoTrack.readyState !== 'live') {
        mediaStream.getTracks().forEach(track => track.stop());
        throw new Error('VANTA could not initialize a live camera track.');
      }
      if (!audioTrack || audioTrack.readyState !== 'live') {
        mediaStream.getTracks().forEach(track => track.stop());
        throw new Error('VANTA could not initialize a live microphone track.');
      }
      videoTrack.enabled = true;
      audioTrack.enabled = true;
      setStream(mediaStream);
      setIsVideoOn(videoTrack.enabled);
      setIsAudioOn(audioTrack.enabled);
      setPermissionState('granted');

      // Get the actual device IDs from the active tracks
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        currentVideoDeviceId.current = settings.deviceId || null;
      }
      if (audioTrack) {
        const settings = audioTrack.getSettings();
        currentAudioDeviceId.current = settings.deviceId || null;
      }

      // Enumerate available devices
      await enumerateDevices();
      return mediaStream;

      } catch (err: any) {
      console.error('Error accessing media devices:', err);
      
      if (err?.name === 'SecurityError' || err?.message === 'SECURE_CONTEXT_REQUIRED') {
        setError('Live requires a secure connection (HTTPS). Open VANTA over https:// or on localhost to enable your camera and microphone.');
        setPermissionState('unavailable');
      } else if (err.name === 'NotSupportedError') {
        setError('Your browser does not support camera and microphone access.');
        setPermissionState('unavailable');
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Camera & microphone access required. Allow access, then tap Retry.');
        setPermissionState('denied');
      } else if (err.name === 'NotFoundError') {
        setError('No camera or microphone found on this device.');
        setPermissionState('unavailable');
      } else if (err.name === 'NotReadableError') {
        setError('Camera or microphone is already in use by another application.');
      } else if (err.name === 'OverconstrainedError') {
        setError('Camera does not support the required settings.');
      } else if (err.name === 'AbortError') {
        setError('Camera access was aborted.');
      } else {
        setError(err.message || 'Failed to access camera and microphone');
      }

        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') setPermissionState('denied');
        throw err;
      } finally {
        setIsLoading(false);
        startPromiseRef.current = null;
      }
    })();
    startPromiseRef.current = request;
    return request;
  }, [enumerateDevices]);

  const stopMedia = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      startPromiseRef.current = null;
      setStream(null);
      setIsVideoOn(false);
      setIsAudioOn(false);
    }
  }, []);

  const toggleVideo = useCallback(async () => {
    if (!streamRef.current) return;
    
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoOn(videoTrack.enabled);
    }
  }, []);

  const toggleAudio = useCallback(async () => {
    if (!streamRef.current) return;
    
    const audioTrack = streamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsAudioOn(audioTrack.enabled);
    }
  }, []);

  const switchCamera = useCallback(async (deviceId: string) => {
    if (!streamRef.current) return;
    
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      const oldVideoTrack = streamRef.current.getVideoTracks()[0];
      const newVideoTrack = newStream.getVideoTracks()[0];

      if (oldVideoTrack) {
        streamRef.current.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }

      streamRef.current.addTrack(newVideoTrack);
      currentVideoDeviceId.current = deviceId;
      
      // Update the stream state to trigger re-render
      setStream(new MediaStream([...streamRef.current.getTracks()]));
    } catch (err) {
      console.error('Error switching camera:', err);
      setError('Failed to switch camera');
    }
  }, []);

  const switchMicrophone = useCallback(async (deviceId: string) => {
    if (!streamRef.current) return;
    
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true },
      });

      const oldAudioTrack = streamRef.current.getAudioTracks()[0];
      const newAudioTrack = newStream.getAudioTracks()[0];

      if (oldAudioTrack) {
        streamRef.current.removeTrack(oldAudioTrack);
        oldAudioTrack.stop();
      }

      streamRef.current.addTrack(newAudioTrack);
      currentAudioDeviceId.current = deviceId;
      
      setStream(new MediaStream([...streamRef.current.getTracks()]));
    } catch (err) {
      console.error('Error switching microphone:', err);
      setError('Failed to switch microphone');
    }
  }, []);

  const getMediaState = useCallback((): MediaDeviceState => ({
    video: isVideoOn,
    audio: isAudioOn,
    videoDeviceId: currentVideoDeviceId.current,
    audioDeviceId: currentAudioDeviceId.current,
  }), [isVideoOn, isAudioOn]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return {
    stream,
    videoDevices,
    audioDevices,
    isVideoOn,
    isAudioOn,
    error,
    permissionState,
    isLoading,
    startMedia,
    stopMedia,
    toggleVideo,
    toggleAudio,
    switchCamera,
    switchMicrophone,
    getMediaState,
  };
}