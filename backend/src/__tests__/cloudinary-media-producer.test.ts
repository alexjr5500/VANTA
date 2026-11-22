import { enqueueCloudinaryMediaForUpload } from '../services/cloudinary-media-producer';

describe('opt-in Cloudinary upload job producer', () => {
  const queue = () => ({ enqueue: jest.fn().mockResolvedValue('job-1') });

  it('enqueues image optimization and thumbnail jobs with deterministic IDs', async () => {
    const repository = queue();
    await enqueueCloudinaryMediaForUpload(
      { id: 'file_123', fileType: 'IMAGE', category: 'post-image' },
      { optimize: true, generateThumbnail: true }, repository,
    );
    expect(repository.enqueue).toHaveBeenNthCalledWith(1, 'image:optimize',
      { fileId: 'file_123' }, { id: 'media-image-optimize-file_123', maxAttempts: 3 });
    expect(repository.enqueue).toHaveBeenNthCalledWith(2, 'thumbnail:generate',
      { fileId: 'file_123' }, { id: 'media-thumbnail-generate-file_123', maxAttempts: 3 });
  });

  it('enqueues managed HLS for reel, story and post video only', async () => {
    const repository = queue();
    for (const category of ['reel', 'story', 'post-video']) {
      await enqueueCloudinaryMediaForUpload({ id: 'file_123', fileType: 'VIDEO', category },
        { optimize: true, generateThumbnail: true }, repository);
    }
    expect(repository.enqueue).toHaveBeenCalledTimes(3);
    expect(repository.enqueue).toHaveBeenLastCalledWith('video:transcode', { fileId: 'file_123' },
      { id: 'media-video-transcode-file_123', maxAttempts: 3 });
  });

  it('does not generate unnecessary jobs for documents, private videos or disabled image options', async () => {
    const repository = queue();
    await enqueueCloudinaryMediaForUpload({ id: 'file_123', fileType: 'DOCUMENT', category: 'generic' },
      { optimize: true, generateThumbnail: true }, repository);
    await enqueueCloudinaryMediaForUpload({ id: 'file_123', fileType: 'VIDEO', category: 'message' },
      { optimize: true, generateThumbnail: true }, repository);
    await enqueueCloudinaryMediaForUpload({ id: 'file_123', fileType: 'IMAGE', category: 'profile-media' },
      { optimize: false, generateThumbnail: false }, repository);
    expect(repository.enqueue).not.toHaveBeenCalled();
  });

  it('propagates enqueue failures for the enclosing database transaction to roll back', async () => {
    const repository = { enqueue: jest.fn().mockRejectedValue(new Error('queue unavailable')) };
    await expect(enqueueCloudinaryMediaForUpload(
      { id: 'file_123', fileType: 'VIDEO', category: 'reel' },
      { optimize: true, generateThumbnail: false }, repository,
    )).rejects.toThrow('queue unavailable');
  });

  it('does not accept arbitrary upload identifiers in queue payloads', async () => {
    const repository = queue();
    await expect(enqueueCloudinaryMediaForUpload(
      { id: '../outside', fileType: 'IMAGE', category: 'post-image' },
      { optimize: true, generateThumbnail: false }, repository,
    )).rejects.toThrow('Invalid UploadedFile ID');
    expect(repository.enqueue).not.toHaveBeenCalled();
  });
});
