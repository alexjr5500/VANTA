// Mobile Optimization Service
// Handles data-saving mode, reduced bandwidth, adaptive media loading

export class MobileOptimizer {
  // Determine optimal quality based on connection type
  getOptimalQuality(connection: any): string {
    const effectiveType = connection?.effectiveType || '4g';
    
    switch (effectiveType) {
      case 'slow-2g':
      case '2g':
        return '144p'; // Minimal bandwidth
      case '3g':
        return '360p'; // Medium quality
      case '4g':
        return '720p'; // High quality
      case '5g':
        return '1080p'; // Full quality
      default:
        return '480p'; // Safe default
    }
  }

  // Get optimal image quality based on data-saving preference
  getImageQuality(dataSavingMode: boolean, connection?: any): number {
    if (dataSavingMode) return 50; // Low quality
    const type = connection?.effectiveType || '4g';
    switch (type) {
      case 'slow-2g':
      case '2g':
        return 30;
      case '3g':
        return 50;
      case '4g':
        return 70;
      case '5g':
        return 85;
      default:
        return 70;
    }
  }

  // Should we preload media based on connection?
  shouldPreloadMedia(connection?: any, dataSavingMode?: boolean): boolean {
    if (dataSavingMode) return false;
    const type = connection?.effectiveType || '4g';
    return type === '4g' || type === '5g' || type === 'wifi';
  }

  // Get optimal video bitrate based on bandwidth
  getOptimalBitrate(bandwidth: number): string {
    if (bandwidth < 200000) return '150k';     // 144p
    if (bandwidth < 500000) return '300k';     // 240p
    if (bandwidth < 1000000) return '500k';    // 360p
    if (bandwidth < 3000000) return '1000k';   // 480p
    if (bandwidth < 8000000) return '2500k';   // 720p
    return '5000k';                             // 1080p
  }

  // Adaptive image URL based on device and connection
  getAdaptiveImageUrl(baseUrl: string, width: number, dataSavingMode: boolean): string {
    if (dataSavingMode) {
      // Return smaller image for data saving
      const maxWidth = Math.min(width, 480);
      return `${baseUrl}?w=${maxWidth}&q=50&format=webp`;
    }
    return `${baseUrl}?w=${width}&format=webp`;
  }

  // Batch API calls for reduced network requests
  batchRequests<T>(requests: (() => Promise<T>)[], batchSize: number = 5): Promise<T[]> {
    const results: T[] = [];
    let index = 0;
    
    const executeBatch = async (): Promise<void> => {
      const batch = requests.slice(index, index + batchSize);
      index += batchSize;
      if (batch.length === 0) return;
      const batchResults = await Promise.all(batch.map(fn => fn()));
      results.push(...batchResults);
      return executeBatch();
    };
    
    return executeBatch().then(() => results);
  }
}

export const mobileOptimizer = new MobileOptimizer();