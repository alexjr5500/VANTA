import { prepareCloudinaryMedia, CloudinaryMediaStore, CloudinaryMediaClient } from '../services/cloudinary-media-job';

describe('Cloudinary durable media processing', () => {
  const createDeps = () => {
    const store: jest.Mocked<CloudinaryMediaStore> = {
      findById: jest.fn().mockResolvedValue({
        id: 'file_123',
        path: 'cloudinary:image:vanta/post-image/asset_1',
        category: 'post-image', fileType: 'IMAGE', deletedAt: null,
      }),
    };
    const client: jest.Mocked<CloudinaryMediaClient> = {
      explicit: jest.fn().mockResolvedValue({
        eager: [{ secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/vanta/output.webp' }],
      }),
    };
    return { store, client };
  };

  it('prepares image derivatives from database-owned Cloudinary IDs', async () => {
    const { store, client } = createDeps();
    await prepareCloudinaryMedia('image:optimize', { fileId: 'file_123', maxWidth: 800 }, store, client);
    expect(store.findById).toHaveBeenCalledWith('file_123');
    expect(client.explicit).toHaveBeenCalledWith('vanta/post-image/asset_1', {
      resource_type: 'image', type: 'upload', eager_async: false,
      eager: [{ width: 800, crop: 'limit', quality: 80, format: 'webp' }],
    });
  });

  it('keeps message thumbnails authenticated', async () => {
    const { store, client } = createDeps();
    store.findById.mockResolvedValue({
      id: 'private_12', path: 'cloudinary:image:vanta/message/private_1',
      category: 'message', fileType: 'IMAGE', deletedAt: null,
    });
    await prepareCloudinaryMedia('thumbnail:generate', { fileId: 'private_12' }, store, client);
    expect(client.explicit).toHaveBeenCalledWith('vanta/message/private_1', {
      resource_type: 'image', type: 'authenticated', eager_async: false,
      eager: [{ width: 320, height: 180, crop: 'fill', quality: 70, format: 'webp' }],
    });
  });

  it('requests a managed HLS rendition from Cloudinary rather than local FFmpeg', async () => {
    const { store, client } = createDeps();
    store.findById.mockResolvedValue({
      id: 'video_12', path: 'cloudinary:video:vanta/reel/video_1',
      category: 'reel', fileType: 'VIDEO', deletedAt: null,
    });
    await prepareCloudinaryMedia('video:transcode', { fileId: 'video_12' }, store, client);
    expect(client.explicit).toHaveBeenCalledWith('vanta/reel/video_1', {
      resource_type: 'video', type: 'upload', eager_async: false,
      eager: [{ streaming_profile: 'hd', format: 'm3u8' }],
    });
    await expect(prepareCloudinaryMedia('video:transcode', {
      fileId: 'video_12', qualities: ['360p'],
    }, store, client)).rejects.toThrow('explicit qualities are unsupported');
  });

  it('rejects missing/deleted assets and non-Cloudinary inputs', async () => {
    const { store, client } = createDeps();
    store.findById.mockResolvedValue(null);
    await expect(prepareCloudinaryMedia('image:optimize', { fileId: 'missing' }, store, client))
      .rejects.toThrow('source is unavailable');
    store.findById.mockResolvedValue({
      id: 'file_123', path: 'cloudinary:image:vanta/post-image/file', category: 'post-image',
      fileType: 'IMAGE', deletedAt: new Date(),
    });
    await expect(prepareCloudinaryMedia('image:optimize', { fileId: 'file_123' }, store, client))
      .rejects.toThrow('source is unavailable');
    store.findById.mockResolvedValue({
      id: 'file_123', path: '/data/uploads/file.jpg', category: 'post-image',
      fileType: 'IMAGE', deletedAt: null,
    });
    await expect(prepareCloudinaryMedia('image:optimize', { fileId: 'file_123' }, store, client))
      .rejects.toThrow('not a supported VANTA asset');
    expect(client.explicit).not.toHaveBeenCalled();
  });

  it('rejects untrusted identifiers, unsupported resource types, and invalid widths', async () => {
    const { store, client } = createDeps();
    await expect(prepareCloudinaryMedia('image:optimize', { fileId: '../outside' }, store, client))
      .rejects.toThrow('valid UploadedFile ID');
    store.findById.mockResolvedValue({
      id: 'file_123', path: 'cloudinary:video:vanta/reel/example',
      category: 'reel', fileType: 'VIDEO', deletedAt: null,
    });
    await expect(prepareCloudinaryMedia('image:optimize', { fileId: 'file_123' }, store, client))
      .rejects.toThrow('does not match');
    store.findById.mockResolvedValue({
      id: 'file_123', path: 'cloudinary:image:vanta/post-image/asset',
      category: 'post-image', fileType: 'IMAGE', deletedAt: null,
    });
    await expect(prepareCloudinaryMedia('image:optimize', { fileId: 'file_123', maxWidth: 9000 }, store, client))
      .rejects.toThrow('Invalid image width');
    expect(client.explicit).not.toHaveBeenCalled();
  });

  it('does not acknowledge processing when the provider has no confirmed output', async () => {
    const { store, client } = createDeps();
    client.explicit.mockResolvedValue({ eager: [] });
    await expect(prepareCloudinaryMedia('thumbnail:generate', { fileId: 'file_123' }, store, client))
      .rejects.toThrow('did not confirm');
  });
});
