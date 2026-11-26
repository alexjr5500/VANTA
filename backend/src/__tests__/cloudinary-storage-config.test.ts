import { assertVerificationUploadAvailable, isCloudinaryStorageConfigured } from '../services/cloudinary-storage-config';

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

  it('fails closed when Cloudinary storage mode is explicitly requested without credentials', () => {
    expect(() => isCloudinaryStorageConfigured({
      VANTA_DURABLE_QUEUE_MEDIA_STORAGE: 'cloudinary',
    })).toThrow('Cloudinary storage mode requires all Cloudinary credentials');
    expect(isCloudinaryStorageConfigured({
      ...valid,
      VANTA_DURABLE_QUEUE_MEDIA_STORAGE: 'cloudinary',
    })).toBe(true);
  });

  it('preserves local fallback only when the Cloudinary mode was not requested', () => {
    expect(isCloudinaryStorageConfigured({
      VANTA_DURABLE_QUEUE_MEDIA_STORAGE: 'local',
    })).toBe(false);
    expect(isCloudinaryStorageConfigured({})).toBe(false);
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

describe('Verification document maintenance guard', () => {
  it.each(['verification', ' Verification ', 'identity', 'KYC'])('rejects %s before storage', category => {
    expect(() => assertVerificationUploadAvailable(category)).toThrow('Secure verification document storage');
  });
  it('rejects verification record bindings even with a generic category', () => {
    expect(() => assertVerificationUploadAvailable('generic', 'VerificationRequest')).toThrow('Secure verification document storage');
  });
  it.each(['post-image', 'reel', 'story', 'message', 'avatar'])('preserves existing upload flow for %s', category => {
    expect(() => assertVerificationUploadAvailable(category)).not.toThrow();
  });
});
