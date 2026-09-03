import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { TrackSource } from '@livekit/protocol';
import { v4 as uuidv4 } from 'uuid';

// No credentials yet — we do NOT crash the whole process. Each capability method
// throws a descriptive error so callers can surface an actionable message to the
// user (e.g. "Live streaming is not configured"). Discovery/chat still work.
const LIVEKIT_HOST = process.env.LIVEKIT_HOST || 'http://localhost:7880';

export class LiveKitNotConfiguredError extends Error {
  constructor() {
    super(
      'Live streaming is not configured. Add LIVEKIT_HOST, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to the backend environment, then restart the server.'
    );
    this.name = 'LiveKitNotConfiguredError';
  }
}

const getCredentials = () => {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new LiveKitNotConfiguredError();
  }
  return { apiKey, apiSecret };
};

const getRoomService = () => {
  const { apiKey, apiSecret } = getCredentials();
  return new RoomServiceClient(LIVEKIT_HOST, apiKey, apiSecret);
};

export class LiveKitService {
  /**
   * Create a LiveKit room for a livestream
   */
  async createRoom(roomName: string): Promise<{ roomName: string }> {
    try {
      await getRoomService().createRoom({
        name: roomName,
        emptyTimeout: 60 * 10, // 10 minutes
        maxParticipants: 50,
      });
      return { roomName };
    } catch (error: any) {
      // Room might already exist
      if (error.message?.includes('already exists')) {
        return { roomName };
      }
      throw error;
    }
  }

  /**
   * Generate an access token for a participant
   */
  async generateToken(
    roomName: string,
    identity: string,
    metadata?: Record<string, any>,
    isHost: boolean = false
  ): Promise<string> {
    const { apiKey, apiSecret } = getCredentials();
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: identity,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
      ttl: '6h',
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      // A host cannot produce a camera/mic/screen stream without publish. A
      // viewer may only subscribe. canPublish:true is sufficient for a host to
      // publish all track sources (camera, microphone, screen share).
      canPublish: isHost,
      canSubscribe: true,
      canPublishData: true,
      hidden: !isHost,
    });

    return at.toJwt();
  }

  /**
   * Generate a host token (can publish video/audio)
   */
  generateHostToken(roomName: string, userId: string, username: string): Promise<string> {
    return this.generateToken(roomName, userId, { username, role: 'host' }, true);
  }

  /**
   * Generate a viewer token (can only subscribe)
   */
  generateViewerToken(roomName: string, userId: string, username: string): Promise<string> {
    return this.generateToken(roomName, userId, { username, role: 'viewer' }, false);
  }

  /**
   * Generate a guest token (can publish but limited)
   */
  async generateGuestToken(roomName: string, userId: string, username: string): Promise<string> {
    const { apiKey, apiSecret } = getCredentials();
    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: username,
      metadata: JSON.stringify({ username, role: 'guest' }),
      ttl: '6h',
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
    });

    return at.toJwt();
  }

  /**
   * Close a LiveKit room
   */
  async closeRoom(roomName: string): Promise<void> {
    try {
      await getRoomService().deleteRoom(roomName);
    } catch (error) {
      console.error('Error closing LiveKit room:', error);
    }
  }

  /**
   * List participants in a room
   */
  async listParticipants(roomName: string): Promise<any[]> {
    try {
      return await getRoomService().listParticipants(roomName);
    } catch {
      return [];
    }
  }

  /**
   * Remove a participant from a room
   */
  async removeParticipant(roomName: string, identity: string): Promise<void> {
    try {
      await getRoomService().removeParticipant(roomName, identity);
    } catch (error) {
      console.error('Error removing participant:', error);
    }
  }

  /**
   * Mute a participant's track
   */
  async muteParticipantTrack(roomName: string, identity: string, trackSid: string, muted: boolean): Promise<void> {
    try {
      await getRoomService().mutePublishedTrack(roomName, identity, trackSid, muted);
    } catch (error) {
      console.error('Error muting participant track:', error);
    }
  }

  /**
   * Generate a unique room name
   */
  generateRoomName(userId: string): string {
    return `vanta_${userId}_${uuidv4().slice(0, 8)}`;
  }
}

export const liveKitService = new LiveKitService();