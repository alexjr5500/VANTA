import { isCloudinaryStorageConfigured } from '../services/cloudinary-storage-config';

describe('Cloudinary upload storage configuration', () => {
  const valid = {
    CLOUDINARY_CLOUD_NAME: 'staging-cloud',
    CLOUDINARY_API_KEY: 'key-for-test',
    CLOUDINARY_API_SECRET: 'secret-for-test',
  };

  it('uses local storage when no Cloudinary settings are provided', () => {
    expect(isCloudinaryStorageConfigured({})).toBe(false);
    expect(isCloudinaryStorageConfigured({
      CLOUDINARY_CLOUD_NAME: '',
      CLOUDINARY_API_KEY: ' ',
      CLOUDINARY_API_SECRET: '',
    })).toBe(false);
  });

  it('enables Cloudinary only when all three credentials are nonempty', () => {
    expect(isCloudinaryStorageConfigured(valid)).toBe(true);
  });

  it.each([
    { CLOUDINARY_CLOUD_NAME: 'staging-cloud' },
    { CLOUDINARY_API_KEY: 'key-for-test' },
    { CLOUDINARY_API_SECRET: 'secret-for-test' },
    { CLOUDINARY_CLOUD_NAME: 'staging-cloud', CLOUDINARY_API_KEY: 'key-for-test' },
    { CLOUDINARY_API_KEY: 'key-for-test', CLOUDINARY_API_SECRET: 'secret-for-test' },
    { CLOUDINARY_CLOUD_NAME: 'staging-cloud', CLOUDINARY_API_SECRET: 'secret-for-test' },
    { ...valid, CLOUDINARY_API_SECRET: '  ' },
  ])('rejects partial credentials rather than silently persisting locally', env => {
    expect(() => isCloudinaryStorageConfigured(env)).toThrow('Incomplete Cloudinary configuration');
  });

  it('does not reveal provided secret values in errors', () => {
    expect(() => isCloudinaryStorageConfigured({
      CLOUDINARY_API_SECRET: 'never-expose-this-secret',
    })).toThrow('Incomplete Cloudinary configuration');
    try {
      isCloudinaryStorageConfigured({ CLOUDINARY_API_SECRET: 'never-expose-this-secret' });
    } catch (error) {
      expect(String(error)).not.toContain('never-expose-this-secret');
    }
  });
});
