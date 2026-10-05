'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Room, RoomEvent, RemoteParticipant, LocalParticipant, ConnectionState, VideoPresets, Track, type AudioCaptureOptions, type VideoCaptureOptions, type TrackPublishOptions } from 'livekit-client';
import { apiGet } from '@/lib/apiClient';
import { applyContinuousAutofocus } from '@/lib/cameraCapture';

interface UseLiveKitOptions {
  token?: string;
  roomName?: string;
  autoConnect?: boolean;
}

interface PublishOptions {
  camera: boolean;
  microphone: boolean;
  cameraDeviceId?: string;
  microphoneDeviceId?: string;
  mediaStream?: MediaStream;
}

interface UseLiveKitReturn {
  room: Room | null;
  token: string | null;
  participants: RemoteParticipant[];
  localParticipant: LocalParticipant | null;
  connectionState: ConnectionState;
  connectionQuality: number;
  isConnecting: boolean;
  error: string | null;
  connect: (token: string, roomName: string, publish?: PublishOptions) => Promise<void>;
  disconnect: () => void;
  toggleCamera: () => Promise<void>;
  toggleMicrophone: () => Promise<void>;
  screenShare: () => Promise<void>;
  isCameraOn: boolean;
  isMicrophoneOn: boolean;
  isScreenSharing: boolean;
  activeSpeakers: string[];
  participantCount: number;
}

export function useLiveKit(options: UseLiveKitOptions = {}): UseLiveKitReturn {
  const [room, setRoom] = useState<Room | null>(null);
  const [liveKitToken, setLiveKitToken] = useState<string | null>(options.token || null);
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [connectionQuality, setConnectionQuality] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isMicrophoneOn, setIsMicrophoneOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>([]);
  const [participantCount, setParticipantCount] = useState(0);

  const roomRef = useRef<Room | null>(null);

  /** Last camera options used to publish — reused if the user toggles the camera
   *  back on, so re-acquired capture keeps the preview's native orientation
   *  instead of snapping back to a cropped 16:9 default. */
  const lastCameraOptionsRef = useRef<VideoCaptureOptions | undefined>(undefined);

  const updateParticipants = useCallback((currentRoom: Room) => {
    const remoteParticipants: RemoteParticipant[] = [];
    currentRoom.remoteParticipants.forEach((participant) => {
      remoteParticipants.push(participant);
    });
    setParticipants(remoteParticipants);
    setParticipantCount(remoteParticipants.length + (currentRoom.localParticipant ? 1 : 0));
  }, []);

  const connect = useCallback(async (token: string, roomName: string, publish?: PublishOptions) => {
    setIsConnecting(true);
    setError(null);
    setLiveKitToken(token);

    try {
      // Create new room if needed
      if (!roomRef.current) {
        // Camera tracks are published by re-acquiring the same hardware the
        // preview used. `videoCaptureDefaults` must NOT cap at 720p: passing
        // 1080p as an `ideal` keeps the published track at the device's native
        // resolution while still falling back gracefully on weak webcams.
        // When a verified preview stream is handed in, the default resolution is
        // derived from the ACTUAL preview capture (which already preserves the
        // device's native portrait orientation). This keeps ANY LiveKit
        // self-acquisition (e.g. toggling the camera back on) on the same
        // natural head/shoulders framing instead of re-cropping a portrait phone
        // sensor to 16:9.
        const previewTrack = publish?.mediaStream?.getVideoTracks()[0];
        const previewSettings =
          typeof previewTrack?.getSettings === 'function' ? previewTrack.getSettings() : null;
        const captureResolution = previewSettings?.width && previewSettings?.height
          ? {
              width: previewSettings.width,
              height: previewSettings.height,
              frameRate: previewSettings.frameRate ?? 30,
            }
          : VideoPresets.h1080.resolution;
        const newRoom = new Room({
          adaptiveStream: true,
          dynacast: true,
          videoCaptureDefaults: {
            resolution: captureResolution,
            facingMode: 'user',
          },
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          publishDefaults: {
            // Full bitrate for the primary layer; LiveKit's congestion control
            // still adapts on weak links. `degradationPreference` keeps the
            // encoder at the captured resolution (drops frames instead of
            // blurring/downscaling) when bandwidth tightens.
            videoEncoding: VideoPresets.h1080.encoding,
            degradationPreference: 'maintain-resolution',
            simulcast: true,
          },
        });

        roomRef.current = newRoom;
        setRoom(newRoom);

        // Setup event listeners
        newRoom.on(RoomEvent.ParticipantConnected, () => {
          updateParticipants(newRoom);
        });

        newRoom.on(RoomEvent.ParticipantDisconnected, () => {
          updateParticipants(newRoom);
        });

        newRoom.on(RoomEvent.TrackPublished, () => {
          updateParticipants(newRoom);
        });

        newRoom.on(RoomEvent.TrackUnpublished, () => {
          updateParticipants(newRoom);
        });

        newRoom.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          setConnectionState(state);
          
          if (state === ConnectionState.Connected) {
            setIsConnecting(false);
          }
          
          if (state === ConnectionState.Disconnected) {
            setIsConnecting(false);
            setLocalParticipant(null);
          }
        });

        newRoom.on(RoomEvent.ConnectionQualityChanged, (quality) => {
          setConnectionQuality(quality as unknown as number);
        });

        newRoom.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          setActiveSpeakers(speakers.map(s => s.identity));
        });

        newRoom.on(RoomEvent.MediaDevicesChanged, () => {
          const cam = newRoom.localParticipant?.isCameraEnabled ?? false;
          const mic = newRoom.localParticipant?.isMicrophoneEnabled ?? false;
          setIsCameraOn(cam);
          setIsMicrophoneOn(mic);
        });

        newRoom.on(RoomEvent.TrackMuted, (pub) => {
          if (pub.kind === 'video') setIsCameraOn(false);
          if (pub.kind === 'audio') setIsMicrophoneOn(false);
        });

        newRoom.on(RoomEvent.TrackUnmuted, (pub) => {
          if (pub.kind === 'video') setIsCameraOn(true);
          if (pub.kind === 'audio') setIsMicrophoneOn(true);
        });

        newRoom.on(RoomEvent.Disconnected, () => {
          setIsScreenSharing(false);
        });

        newRoom.on(RoomEvent.Reconnecting, () => {
          setIsConnecting(true);
        });

        newRoom.on(RoomEvent.Reconnected, () => {
          setIsConnecting(false);
        });
      }

      // Connect to the room. Resolve the signaling URL for this session and
      // retry with short backoff so a server that is still coming up (e.g.
      // right after the PC restarts, before the background LiveKit service has
      // finished starting) does not fail the very first go-live attempt. Only
      // after every attempt fails is the "LiveKit is not connected" error
      // surfaced — i.e. when the server is genuinely unavailable.
      const liveKitUrl = getLiveKitUrl();
      let lastConnectError: unknown;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
          const backoff = attempt === 1 ? 400 : 1200;
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
        try {
          await roomRef.current.connect(liveKitUrl, token);
          lastConnectError = null;
          break;
        } catch (err) {
          lastConnectError = err;
          // Leave the room object in a clean state for the next attempt.
          try {
            roomRef.current.disconnect();
          } catch {
            // Room may not be connected yet; nothing to tear down.
          }
        }
      }

      if (lastConnectError) {
        throw new Error(
          `LiveKit is not connected. The LiveKit server at ${liveKitUrl} could not be reached after multiple attempts. It starts automatically with Windows — if it is still down, start the VANTA LiveKit background service and retry.`
        );
      }

      if (publish) {
        const previewVideo = publish.mediaStream?.getVideoTracks()[0];
        const previewAudio = publish.mediaStream?.getAudioTracks()[0];
        if (publish.camera && (!previewVideo || previewVideo.readyState !== 'live')) throw new Error('Camera track is not live');
        if (publish.microphone && (!previewAudio || previewAudio.readyState !== 'live')) throw new Error('Microphone track is not live');

        // Build capture options from the PREVIEW track's actual device/resolution.
        // This is what actually preserves the camera the user chose (deviceId)
        // AND the captured resolution through publish — LiveKit would otherwise
        // re-acquire the default front camera at 720p.
        let cameraCaptureOptions: VideoCaptureOptions | undefined;
        if (publish.camera && previewVideo) {
          const settings = typeof previewVideo.getSettings === 'function' ? previewVideo.getSettings() : null;
          const deviceId = publish.cameraDeviceId ?? settings?.deviceId;
          // Prefer the dimensions the preview is actually capturing at; fall
          // back to a 1080p ideal so weak webcams still publish sharply.
          cameraCaptureOptions = {
            deviceId: deviceId ? { ideal: deviceId } : undefined,
            facingMode:
              settings?.facingMode === 'environment'
                ? 'environment'
                : settings?.facingMode === 'user'
                  ? 'user'
                  : undefined,
            resolution: {
              width: settings?.width ?? VideoPresets.h1080.resolution.width,
              height: settings?.height ?? VideoPresets.h1080.resolution.height,
              frameRate: settings?.frameRate ?? VideoPresets.h1080.resolution.frameRate,
            },
          };
          // Remember the granted device/orientation so a camera toggle (off→on)
          // re-acquires the same natural framing instead of the room's default.
          lastCameraOptionsRef.current = cameraCaptureOptions;
        }

        // Same treatment for the microphone: carry the PREVIEW audio track's
        // actual device (and the same echo/suppression processing the preview
        // used) into the LiveKit published track. Without the deviceId, LiveKit
        // re-acquires the OS default mic, which on phones with earbuds/headsets
        // is a DIFFERENT microphone than the one the user granted — the user
        // speaks but the published track is silent. Carrying the granted device
        // keeps the published mic identical to the verified preview mic.
        let microphoneCaptureOptions: AudioCaptureOptions | undefined;
        if (publish.microphone && previewAudio) {
          const settings = typeof previewAudio.getSettings === 'function' ? previewAudio.getSettings() : null;
          const micDeviceId = publish.microphoneDeviceId ?? settings?.deviceId;
          microphoneCaptureOptions = {
            deviceId: micDeviceId ? { ideal: micDeviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          };
        }

        const publishOptions: TrackPublishOptions = {
          videoEncoding: VideoPresets.h1080.encoding,
          degradationPreference: 'maintain-resolution',
          simulcast: true,
        };

        // LiveKit acquires the same selected hardware after the verified preview
        // tracks are released. This avoids two simultaneous captures of one camera.
        publish.mediaStream?.getTracks().forEach(track => track.stop());
        const [cameraPub, micPub] = await Promise.all([
          publish.camera
            ? roomRef.current.localParticipant.setCameraEnabled(true, cameraCaptureOptions, publishOptions)
            : Promise.resolve(undefined),
          publish.microphone
            ? roomRef.current.localParticipant.setMicrophoneEnabled(true, microphoneCaptureOptions)
            : Promise.resolve(undefined),
        ]);

        if (publish.camera) {
          let pub = cameraPub;
          if (!pub) {
            // find the camera publication (setCameraEnabled may resolve before
            // the publication is observable through isCameraEnabled).
            for (const publication of roomRef.current.localParticipant.videoTrackPublications.values()) {
              if (publication.source === Track.Source.Camera) { pub = publication; break; }
            }
          }
          const mt = pub?.track?.mediaStreamTrack;
          if (!mt || mt.readyState !== 'live') throw new Error('Camera was not published');
          await applyContinuousAutofocus(mt);
        }
        if (publish.microphone) {
          let mpub = micPub;
          if (!mpub) {
            // find the microphone publication the same way as the camera above.
            for (const publication of roomRef.current.localParticipant.audioTrackPublications.values()) {
              if (publication.source === Track.Source.Microphone) { mpub = publication; break; }
            }
          }
          const mt = mpub?.track?.mediaStreamTrack;
          if (!mt || mt.readyState !== 'live') throw new Error('Microphone was not published');
        }
      }
      
      setLocalParticipant(roomRef.current.localParticipant);
      updateParticipants(roomRef.current);

      const cam = roomRef.current.localParticipant?.isCameraEnabled ?? false;
      const mic = roomRef.current.localParticipant?.isMicrophoneEnabled ?? false;
      setIsCameraOn(cam);
      setIsMicrophoneOn(mic);

    } catch (err: any) {
      console.error('LiveKit connection error:', err);
      setError(err.message || 'Failed to connect to the stream');
      setIsConnecting(false);

      throw err;
    }
  }, [updateParticipants]);

  const disconnect = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect();
    }
    // Fully release the Room instance. `connect` re-creates a fresh Room (and
    // fresh LocalParticipant) on the next call, which is the exact path the
    // host takes on Go-Live. Reusing a disconnected Room for a second
    // connect+publish (the viewer → guest stage-join flow) can leave stale
    // participant/engine state that drops the newly published microphone
    // track even though the camera publishes fine.
    roomRef.current = null;
    setRoom(null);
    setParticipants([]);
    setLocalParticipant(null);
    setParticipantCount(0);
    setLiveKitToken(null);
    setConnectionState(ConnectionState.Disconnected);
    setIsConnecting(false);
    setIsCameraOn(false);
    setIsMicrophoneOn(false);
    setIsScreenSharing(false);
  }, []);

  const toggleCamera = useCallback(async () => {
    if (!roomRef.current?.localParticipant) return;
    try {
      // Reuse the last published capture options so re-enabling the camera keeps
      // the preview's native resolution/orientation (natural head/shoulders
      // framing) instead of re-acquiring a cropped 16:9 default.
      await roomRef.current.localParticipant.setCameraEnabled(!isCameraOn, lastCameraOptionsRef.current);
      setIsCameraOn(roomRef.current.localParticipant.isCameraEnabled);
    } catch (err) {
      console.error('Error toggling camera:', err);
    }
  }, [isCameraOn]);

  const toggleMicrophone = useCallback(async () => {
    if (!roomRef.current?.localParticipant) return;
    try {
      await roomRef.current.localParticipant.setMicrophoneEnabled(!isMicrophoneOn);
      setIsMicrophoneOn(roomRef.current.localParticipant.isMicrophoneEnabled);
    } catch (err) {
      console.error('Error toggling microphone:', err);
    }
  }, [isMicrophoneOn]);

  const screenShare = useCallback(async () => {
    if (!roomRef.current?.localParticipant) return;
    try {
      if (isScreenSharing) {
        await roomRef.current.localParticipant.setScreenShareEnabled(false);
        setIsScreenSharing(false);
      } else {
        await roomRef.current.localParticipant.setScreenShareEnabled(true);
        setIsScreenSharing(true);
      }
    } catch (err) {
      console.error('Error toggling screen share:', err);
    }
  }, [isScreenSharing]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    };
  }, []);

  return {
    room: roomRef.current,
    token: liveKitToken,
    participants,
    localParticipant,
    connectionState,
    connectionQuality,
    isConnecting,
    error,
    connect,
    disconnect,
    toggleCamera,
    toggleMicrophone,
    screenShare,
    isCameraOn,
    isMicrophoneOn,
    isScreenSharing,
    activeSpeakers,
    participantCount,
  };
}

// Resolve the LiveKit signaling URL for the current session.
//
// - Uses NEXT_PUBLIC_LIVEKIT_URL when configured. This repo points it at the
//   local WSS bridge (wss://<LAN-IP>:7443) so HTTPS/mobile sessions are not
//   blocked as mixed content, while desktop HTTP sessions can still connect.
// - Otherwise derives a URL from the page's own origin so Live keeps working
//   even when the env var is unset.
export function getLiveKitUrl(): string {
  const configured = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (configured) return configured;

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const host = window.location.hostname;
    const isSecure =
      window.location.protocol === 'https:' || window.location.protocol === 'wss:';
    return isSecure ? `wss://${host}:7443` : `ws://${host}:7880`;
  }

  return 'ws://localhost:7880';
}

// Helper to get LiveKit token from backend
export async function getLiveKitToken(streamId: string, token: string, role: 'host' | 'viewer' = 'viewer'): Promise<string> {
  const endpoint = role === 'host' ? `/api/live/${streamId}/host-token` : `/api/live/${streamId}/viewer-token`;
  const data = await apiGet<any>(endpoint, token);
  return data.token;
}