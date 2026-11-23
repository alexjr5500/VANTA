import { prepareCloudinaryMedia, CloudinaryMediaStore, CloudinaryMediaClient } from '../services/cloudinary-media-job';

describe('Cloudinary durable media processing', () => {
  const createDeps = () => {
    const store: jest.Mocked<CloudinaryMediaStore> = {
      saveDerivative: jest.fn().mockResolvedValue(true),
      findById: jest.fn().mockResolvedValue({
        id: 'file_123',
        path: 'cloudinary:image:vanta/post-image/asset_1',
        category: 'post-image', fileType: 'IMAGE', deletedAt: null,
      }),
    };
    const client: jest.Mocked<CloudinaryMediaClient> = {
      cloudName: 'test-cloud',
      explicit: jest.fn().mockResolvedValue({
        eager: [{ secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/c_limit,w_800/vanta/post-image/asset_1.webp' }],
      }),
    };
    return { store, client };
  };

  it('prepares image derivatives from database-owned Cloudinary IDs', async () => {
    const { store, client } = createDeps();
    await prepareCloudinaryMedia('cloudinary:image:optimize', { fileId: 'file_123', maxWidth: 800 }, store, client);
    expect(store.findById).toHaveBeenCalledWith('file_123');
    expect(store.saveDerivative).toHaveBeenCalledWith(expect.objectContaining({ id: 'file_123', path: 'cloudinary:image:vanta/post-image/asset_1', category: 'post-image', fileType: 'IMAGE' }), 'cloudinary:image:optimize', 'https://res.cloudinary.com/test-cloud/image/upload/c_limit,w_800/vanta/post-image/asset_1.webp');
    expect(client.explicit).toHaveBeenCalledWith('vanta/post-image/asset_1', {
      resource_type: 'image', type: 'upload', eager_async: false,
      eager: [{ width: 800, crop: 'limit', quality: 80, format: 'webp' }],
    });
  });

  it('never publishes public derivative URLs for private message uploads', async () => {
    const { store, client } = createDeps();
    store.findById.mockResolvedValue({
      id: 'private_12', path: 'cloudinary:image:vanta/message/private_1',
      category: 'message', fileType: 'IMAGE', deletedAt: null,
    });
    await expect(prepareCloudinaryMedia('cloudinary:thumbnail:generate',
      { fileId: 'private_12' }, store, client)).rejects.toThrow('Private message media');
    expect(client.explicit).not.toHaveBeenCalled();
    expect(store.saveDerivative).not.toHaveBeenCalled();
  });

  it('requests a managed HLS rendition from Cloudinary rather than local FFmpeg', async () => {
    const { store, client } = createDeps();
    store.findById.mockResolvedValue({
      id: 'video_12', path: 'cloudinary:video:vanta/reel/video_1',
      category: 'reel', fileType: 'VIDEO', deletedAt: null,
    });
    client.explicit.mockResolvedValue({
      eager: [{ secure_url: 'https://res.cloudinary.com/test-cloud/video/upload/sp_hd/vanta/reel/video_1.m3u8' }],
    });
    await prepareCloudinaryMedia('cloudinary:video:transcode', { fileId: 'video_12' }, store, client);
    expect(store.saveDerivative).toHaveBeenCalledWith(expect.objectContaining({ id: 'video_12', path: 'cloudinary:video:vanta/reel/video_1', category: 'reel', fileType: 'VIDEO' }), 'cloudinary:video:transcode', expect.stringMatching(new RegExp('[.]m3u8$')));
    expect(client.explicit).toHaveBeenCalledWith('vanta/reel/video_1', {
      resource_type: 'video', type: 'upload', eager_async: false,
      eager: [{ streaming_profile: 'hd', format: 'm3u8' }],
    });
    await expect(prepareCloudinaryMedia('cloudinary:video:transcode', {
      fileId: 'video_12', qualities: ['360p'],
    }, store, client)).rejects.toThrow('explicit qualities are unsupported');
  });

  it('rejects missing/deleted assets and non-Cloudinary inputs', async () => {
    const { store, client } = createDeps();
    store.findById.mockResolvedValue(null);
    await expect(prepareCloudinaryMedia('cloudinary:image:optimize', { fileId: 'missing' }, store, client))
      .rejects.toThrow('source is unavailable');
    store.findById.mockResolvedValue({
      id: 'file_123', path: 'cloudinary:image:vanta/post-image/file', category: 'post-image',
      fileType: 'IMAGE', deletedAt: new Date(),
    });
    await expect(prepareCloudinaryMedia('cloudinary:image:optimize', { fileId: 'file_123' }, store, client))
      .rejects.toThrow('source is unavailable');
    store.findById.mockResolvedValue({
      id: 'file_123', path: '/data/uploads/file.jpg', category: 'post-image',
      fileType: 'IMAGE', deletedAt: null,
    });
    await expect(prepareCloudinaryMedia('cloudinary:image:optimize', { fileId: 'file_123' }, store, client))
      .rejects.toThrow('not a supported VANTA asset');
    expect(client.explicit).not.toHaveBeenCalled();
  });

  it('rejects untrusted identifiers, unsupported resource types, and invalid widths', async () => {
    const { store, client } = createDeps();
    await expect(prepareCloudinaryMedia('cloudinary:image:optimize', { fileId: '../outside' }, store, client))
      .rejects.toThrow('valid UploadedFile ID');
    store.findById.mockResolvedValue({
      id: 'file_123', path: 'cloudinary:video:vanta/reel/example',
      category: 'reel', fileType: 'VIDEO', deletedAt: null,
    });
    await expect(prepareCloudinaryMedia('cloudinary:image:optimize', { fileId: 'file_123' }, store, client))
      .rejects.toThrow('does not match');
    store.findById.mockResolvedValue({
      id: 'file_123', path: 'cloudinary:image:vanta/post-image/asset',
      category: 'post-image', fileType: 'IMAGE', deletedAt: null,
    });
    await expect(prepareCloudinaryMedia('cloudinary:image:optimize', { fileId: 'file_123', maxWidth: 9000 }, store, client))
      .rejects.toThrow('Invalid image width');
    expect(client.explicit).not.toHaveBeenCalled();
  });

  it('does not acknowledge processing when the provider has no confirmed output', async () => {
    const { store, client } = createDeps();
    client.explicit.mockResolvedValue({ eager: [] });
    await expect(prepareCloudinaryMedia('cloudinary:thumbnail:generate', { fileId: 'file_123' }, store, client))
      .rejects.toThrow('did not confirm');
    expect(store.saveDerivative).not.toHaveBeenCalled();
  });

  it('rejects unsafe external URLs and incorrect output formats', async () => {
    const { store, client } = createDeps();
    for (const url of [
      'https://evil.example/image/upload/asset.webp',
      'http://res.cloudinary.com/test-cloud/image/upload/asset.webp',
      'https://res.cloudinary.com/test-cloud/image/upload/asset.mp4',
      'https://res.cloudinary.com/other-cloud/image/upload/vanta/post-image/asset_1.webp',
      'https://res.cloudinary.com/test-cloud/image/upload/vanta/post-image/different_asset.webp',
      'https://res.cloudinary.com/test-cloud/image/upload/vanta/post-image/asset_1.webp?public=true',
    ]) {
      client.explicit.mockResolvedValue({ eager: [{ secure_url: url }] });
      await expect(prepareCloudinaryMedia('cloudinary:image:optimize',
        { fileId: 'file_123' }, store, client)).rejects.toThrow('safe media derivative URL');
    }
    expect(store.saveDerivative).not.toHaveBeenCalled();
  });

  it('refuses to complete when the asset was deleted or replaced during transformation', async () => {
    const { store, client } = createDeps();
    store.saveDerivative.mockResolvedValue(false);
    await expect(prepareCloudinaryMedia('cloudinary:image:optimize',
      { fileId: 'file_123' }, store, client)).rejects.toThrow('changed or was deleted');
    expect(store.saveDerivative).toHaveBeenCalledWith(expect.objectContaining({ category: 'post-image', fileType: 'IMAGE', deletedAt: null }), 'cloudinary:image:optimize', expect.stringContaining('.webp'));
    expect(store.saveDerivative).toHaveBeenCalledTimes(1);
  });
});
