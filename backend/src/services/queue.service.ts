import { cacheService } from './cache.service';

// Background job processing service
// Handles video transcoding, image compression, thumbnail generation,
// email sending, notification delivery, analytics aggregation, moderation scans

type JobHandler = (job: Job) => Promise<any>;

interface Job {
  id: string;
  type: string;
  data: any;
  priority: number;
  createdAt: Date;
  attempts: number;
  maxAttempts: number;
  scheduledAt?: Date;
  timeout?: number; // Job timeout in ms
  tags?: string[]; // Tags for job grouping
  groupId?: string; // Group ID for job deduplication
  progress?: number; // 0-100 progress tracking
}

interface QueueOptions {
  concurrency: number;
  maxAttempts: number;
  backoffDelay: number; // Base delay in ms
  enablePersistence: boolean;
}

type JobStatus = 'pending' | 'active' | 'completed' | 'failed' | 'delayed';

interface JobRecord {
  job: Job;
  status: JobStatus;
  result?: any;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

const DEFAULT_OPTIONS: QueueOptions = {
  concurrency: 10,
  maxAttempts: 3,
  backoffDelay: 1000,
  enablePersistence: true,
};

class JobQueue {
  private queue: Job[] = [];
  private delayedQueue: Map<string, NodeJS.Timeout> = new Map();
  private handlers: Map<string, JobHandler> = new Map();
  private activeJobs: number = 0;
  private processedJobs: number = 0;
  private failedJobs: number = 0;
  private isProcessing: boolean = false;
  private options: QueueOptions;
  private jobHistory: Map<string, JobRecord> = new Map();
  private readonly MAX_HISTORY_SIZE = 1000;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly QUEUE_PERSISTENCE_KEY = 'queue:persistence';

  constructor(options: Partial<QueueOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.startProcessingInterval();
    this.restorePersistedJobs();
  }

  private startProcessingInterval(): void {
    // Process delayed jobs every second
    this.processingInterval = setInterval(() => {
      this.processDelayedJobs();
    }, 1000);
  }

  private async restorePersistedJobs(): Promise<void> {
    if (!this.options.enablePersistence) return;
    try {
      const persisted = await cacheService.get<Job[]>(this.QUEUE_PERSISTENCE_KEY);
      if (persisted && Array.isArray(persisted)) {
        for (const job of persisted) {
          this.queue.push(job);
        }
        console.log(`[Queue] Restored ${persisted.length} jobs from persistence`);
        if (this.queue.length > 0 && !this.isProcessing) {
          this.processQueue();
        }
      }
    } catch {
      // Ignore persistence restore errors
    }
  }

  private async persistQueue(): Promise<void> {
    if (!this.options.enablePersistence) return;
    try {
      // Only persist pending jobs
      const pendingJobs = this.queue.filter(j => j.attempts < j.maxAttempts);
      if (pendingJobs.length > 0) {
        await cacheService.set(this.QUEUE_PERSISTENCE_KEY, pendingJobs.slice(0, 500), 86_400_000);
      }
    } catch {
      // Ignore persistence errors
    }
  }

  private processDelayedJobs(): void {
    const now = new Date();
    for (const [id, timer] of this.delayedQueue) {
      // Timers will fire automatically, this is just a cleanup check
    }
  }

  // Register a handler for a job type
  registerHandler(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  // Add a job to the queue
  async add(
    type: string, 
    data: any, 
    priority: number = 0,
    options?: { 
      delay?: number; 
      timeout?: number; 
      tags?: string[];
      groupId?: string;
      scheduledAt?: Date;
    }
  ): Promise<string> {
    const jobId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const job: Job = {
      id: jobId,
      type,
      data,
      priority,
      createdAt: new Date(),
      attempts: 0,
      maxAttempts: this.options.maxAttempts,
      timeout: options?.timeout,
      tags: options?.tags,
      groupId: options?.groupId,
      scheduledAt: options?.scheduledAt,
    };

    // Check for duplicate group jobs
    if (job.groupId) {
      const existingDuplicate = this.queue.find(
        j => j.groupId === job.groupId && j.type === type && j.attempts === 0
      );
      if (existingDuplicate) {
        return existingDuplicate.id; // Return existing job ID instead of creating duplicate
      }
    }

    // If job is scheduled for later, add to delayed queue
    if (options?.delay || options?.scheduledAt) {
      const delay = options?.delay || (options?.scheduledAt ? options.scheduledAt.getTime() - Date.now() : 0);
      if (delay > 0) {
        const timer = setTimeout(() => {
          this.queue.push(job);
          this.queue.sort((a, b) => b.priority - a.priority);
          this.delayedQueue.delete(jobId);
          if (!this.isProcessing) {
            this.processQueue();
          }
          this.persistQueue();
        }, delay);
        this.delayedQueue.set(jobId, timer);
        this.jobHistory.set(jobId, { job, status: 'delayed' });
        return jobId;
      }
    }

    this.queue.push(job);
    // Sort by priority (higher = first)
    this.queue.sort((a, b) => b.priority - a.priority);

    this.jobHistory.set(jobId, { job, status: 'pending' });

    // Start processing if not already running
    if (!this.isProcessing) {
      this.processQueue();
    }

    this.persistQueue();
    return job.id;
  }

  // Add multiple jobs at once
  async addBulk(
    jobs: Array<{
      type: string;
      data: any;
      priority?: number;
      options?: { delay?: number; timeout?: number; tags?: string[]; groupId?: string };
    }>
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const j of jobs) {
      const id = await this.add(j.type, j.data, j.priority, j.options);
      ids.push(id);
    }
    return ids;
  }

  // Schedule a recurring job
  async schedule(
    type: string,
    data: any,
    cronExpression: string,
    handler: JobHandler
  ): Promise<void> {
    this.registerHandler(type, handler);
    
    // Simple interval-based scheduling (cron expression parsing would need a library)
    const parts = cronExpression.split(' ');
    if (parts.length === 5) {
      // Every minute, hour, day, etc.
      let interval = 60_000; // Default: every minute
      const minute = parts[0];
      const hour = parts[1];
      const dayOfMonth = parts[2];
      const month = parts[3];
      const dayOfWeek = parts[4];

      if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        interval = 60_000; // Every minute
      } else if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        interval = 3_600_000; // Every hour
      } else if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        interval = 86_400_000; // Every day
      }

      // Start the recurring job
      const executeJob = async () => {
        try {
          await handler({
            id: `${type}-scheduled-${Date.now()}`,
            type,
            data: { ...data, scheduledAt: new Date() },
            priority: 10,
            createdAt: new Date(),
            attempts: 0,
            maxAttempts: 1,
          });
        } catch (err) {
          console.error(`[Queue] Scheduled job ${type} failed:`, err);
        }
      };

      // Execute immediately, then on interval
      executeJob();
      setInterval(executeJob, interval);
      console.log(`[Queue] Scheduled ${type} every ${interval / 1000}s`);
    }
  }

  // Get queue statistics
  get stats() {
    return {
      pending: this.queue.length,
      active: this.activeJobs,
      processed: this.processedJobs,
      failed: this.failedJobs,
      delayed: this.delayedQueue.size,
      total: this.processedJobs + this.failedJobs + this.queue.length + this.activeJobs + this.delayedQueue.size,
    };
  }

  // Get job status
  getJobStatus(jobId: string): JobRecord | undefined {
    return this.jobHistory.get(jobId);
  }

  // Get jobs by status
  getJobsByStatus(status: JobStatus): JobRecord[] {
    const records: JobRecord[] = [];
    for (const record of this.jobHistory.values()) {
      if (record.status === status) {
        records.push(record);
      }
    }
    return records;
  }

  // Cancel a job
  cancelJob(jobId: string): boolean {
    // Check in delayed queue
    if (this.delayedQueue.has(jobId)) {
      clearTimeout(this.delayedQueue.get(jobId)!);
      this.delayedQueue.delete(jobId);
      this.jobHistory.set(jobId, { job: this.jobHistory.get(jobId)?.job!, status: 'failed', error: 'Cancelled' });
      return true;
    }
    // Check in pending queue
    const index = this.queue.findIndex(j => j.id === jobId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.jobHistory.set(jobId, { job: this.jobHistory.get(jobId)?.job!, status: 'failed', error: 'Cancelled' });
      return true;
    }
    return false;
  }

  // Clear all pending jobs
  clearPending(): void {
    this.queue = [];
    this.persistQueue();
  }

  // Pause processing
  pause(): void {
    this.isProcessing = false;
  }

  // Resume processing
  resume(): void {
    if (!this.isProcessing && this.queue.length > 0) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const processNext = async () => {
      while (this.queue.length > 0 && this.activeJobs < this.options.concurrency) {
        const job = this.queue.shift();
        if (!job) break;

        this.activeJobs++;
        this.jobHistory.set(job.id, { job, status: 'active', startedAt: new Date() });
        
        this.processJob(job)
          .finally(() => {
            this.activeJobs--;
            if (this.queue.length > 0) {
              processNext();
            } else {
              this.isProcessing = false;
            }
          });
      }

      if (this.activeJobs === 0) {
        this.isProcessing = false;
      }
    };

    processNext();
  }

  private async processJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      console.warn(`[Queue] No handler registered for job type: ${job.type}`);
      this.failedJobs++;
      this.jobHistory.set(job.id, { job, status: 'failed', error: 'No handler registered' });
      return;
    }

    // Create a timeout promise if job has timeout
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = job.timeout 
      ? new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Job ${job.type} (${job.id}) timed out after ${job.timeout}ms`));
          }, job.timeout);
        })
      : null;

    try {
      const result = await (timeoutPromise 
        ? Promise.race([handler(job), timeoutPromise])
        : handler(job));
      
      this.processedJobs++;
      this.jobHistory.set(job.id, { 
        job, 
        status: 'completed', 
        result, 
        startedAt: this.jobHistory.get(job.id)?.startedAt,
        completedAt: new Date() 
      });
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Queue] Completed: ${job.type} (${job.id})`);
      }
    } catch (error) {
      job.attempts++;
      
      if (job.attempts < job.maxAttempts) {
        // Retry with exponential backoff + jitter
        const baseDelay = this.options.backoffDelay * Math.pow(2, job.attempts - 1);
        const jitter = Math.random() * 1000; // Add up to 1s random jitter
        const delay = Math.min(baseDelay + jitter, 30000); // Max 30s delay
        
        setTimeout(() => {
          this.queue.push(job);
          this.queue.sort((a, b) => b.priority - a.priority);
          if (!this.isProcessing) {
            this.processQueue();
          }
          this.persistQueue();
        }, delay);
        
        console.warn(`[Queue] Retry ${job.attempts}/${job.maxAttempts}: ${job.type} (${job.id}) after ${Math.round(delay)}ms`);
      } else {
        this.failedJobs++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.jobHistory.set(job.id, { 
          job, 
          status: 'failed', 
          error: errorMessage,
          startedAt: this.jobHistory.get(job.id)?.startedAt,
          completedAt: new Date() 
        });
        console.error(`[Queue] Failed after ${job.attempts} attempts: ${job.type} (${job.id})`, errorMessage);
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  // Clean up resources
  destroy(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    for (const [, timer] of this.delayedQueue) {
      clearTimeout(timer);
    }
    this.delayedQueue.clear();
    this.queue = [];
    this.isProcessing = false;
  }
}

// Pre-defined job types for VANTA
export const JOB_TYPES = {
  VIDEO_TRANSCODE: 'video:transcode',
  IMAGE_OPTIMIZE: 'image:optimize',
  THUMBNAIL_GENERATE: 'thumbnail:generate',
  EMAIL_SEND: 'email:send',
  NOTIFICATION_DELIVER: 'notification:deliver',
  ANALYTICS_AGGREGATE: 'analytics:aggregate',
  MODERATION_SCAN: 'moderation:scan',
  BACKUP_CREATE: 'backup:create',
  CACHE_WARM: 'cache:warm',
  CLEANUP_TEMP: 'cleanup:temp',
  LEADERBOARD_UPDATE: 'leaderboard:update',
  STORY_CLEANUP: 'story:cleanup',
  SESSION_CLEANUP: 'session:cleanup',
  EXPIRED_CONTENT_CLEANUP: 'cleanup:expired',
  GIFT_COMBO_PROCESS: 'gift:combo:process',
  STREAM_METRICS_UPDATE: 'stream:metrics:update',
  RECOMMENDATIONS_UPDATE: 'recommendations:update',
  SEARCH_INDEX_UPDATE: 'search:index:update',
};

// Job priority constants
export const JOB_PRIORITY = {
  CRITICAL: 100,  // User-facing operations (e.g., gift processing)
  HIGH: 50,       // Important background tasks
  NORMAL: 0,      // Default priority
  LOW: -50,       // Non-urgent tasks
  BACKGROUND: -100, // Analytics, cleanup
};

// Export singleton
export const jobQueue = new JobQueue({ 
  concurrency: 10, 
  maxAttempts: 3, 
  enablePersistence: true 
});