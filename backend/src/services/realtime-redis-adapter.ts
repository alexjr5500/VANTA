import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server } from 'socket.io';

export interface RealtimeRedisConfig {
  url: string;
  channelPrefix: string;
  transport: 'websocket' | 'sticky';
}

/** Disabled unless explicitly enabled; no localhost/default Redis or channel fallback. */
export function realtimeRedisConfig(env: Record<string, string | undefined>): RealtimeRedisConfig | null {
  if (env.VANTA_SOCKET_REDIS_ENABLED !== 'true') return null;
  const url = env.VANTA_SOCKET_REDIS_URL;
  const channelPrefix = env.VANTA_SOCKET_REDIS_PREFIX;
  const transport = env.VANTA_SOCKET_REDIS_TRANSPORT;
  if (!url || !channelPrefix || !/^vanta:[a-zA-Z0-9_-]{1,60}:socket$/.test(channelPrefix) ||
      (transport !== 'websocket' && transport !== 'sticky')) {
    throw new Error('Explicit isolated realtime Redis URL, prefix and transport policy required');
  }
  try {
    if (!['redis:', 'rediss:'].includes(new URL(url).protocol)) throw new Error();
  } catch {
    throw new Error('Invalid realtime Redis URL');
  }
  return { url, channelPrefix, transport };
}

/** Separate pub/sub clients: no application cache commands on the subscriber. */
export class RealtimeRedisAdapter {
  private publisher?: Redis;
  private subscriber?: Redis;
  private installed = false;

  constructor(private readonly config: RealtimeRedisConfig | null) {}

  get ready(): boolean {
    return !this.config || (this.installed && this.publisher?.status === 'ready' && this.subscriber?.status === 'ready');
  }

  async start(io: Server): Promise<void> {
    if (!this.config) return;
    if (this.publisher || this.subscriber) throw new Error('Realtime adapter already initialized');
    const options = {
      lazyConnect: true, enableOfflineQueue: false, connectTimeout: 5000,
      commandTimeout: 5000, maxRetriesPerRequest: 1,
      retryStrategy: (attempt: number) => Math.min(attempt * 100, 2000),
    };
    const publisher = new Redis(this.config.url, options);
    const subscriber = new Redis(this.config.url, options);
    this.publisher = publisher;
    this.subscriber = subscriber;
    publisher.on('error', () => console.warn('[RealtimeRedis] Publisher error'));
    subscriber.on('error', () => console.warn('[RealtimeRedis] Subscriber error'));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([publisher.connect(), subscriber.connect()]),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Realtime Redis deadline')), 8000); }),
      ]);
      if (publisher.status !== 'ready' || subscriber.status !== 'ready') throw new Error('Not ready');
      io.adapter(createAdapter(publisher, subscriber, {
        key: this.config.channelPrefix, requestsTimeout: 3000, publishOnSpecificResponseChannel: true,
      }));
      this.installed = true;
    } catch {
      this.close();
      throw new Error('Realtime Redis adapter startup failed');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  close(): void {
    this.installed = false;
    this.publisher?.disconnect();
    this.subscriber?.disconnect();
    this.publisher = undefined;
    this.subscriber = undefined;
  }
}
