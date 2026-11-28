import { isPublicCloudinaryDerivative } from '../services/cloudinary-media-categories';

describe('Cloudinary public derivative routing', () => {
  test.each(['reel', 'story', 'post-video'])('allows video in %s', category => {
    expect(isPublicCloudinaryDerivative('VIDEO', category)).toBe(true);
  });
  test.each(['avatar', 'banner', 'profile-media', 'post-image'])('allows image in %s', category => {
    expect(isPublicCloudinaryDerivative('IMAGE', category)).toBe(true);
  });
  test.each(['message', 'verification', 'generic', 'identity'])('blocks sensitive or ambiguous category %s', category => {
    expect(isPublicCloudinaryDerivative('IMAGE', category)).toBe(false);
    expect(isPublicCloudinaryDerivative('VIDEO', category)).toBe(false);
  });
  test('rejects documents and audio for public derivatives', () => {
    expect(isPublicCloudinaryDerivative('DOCUMENT', 'post-image')).toBe(false);
    expect(isPublicCloudinaryDerivative('AUDIO', 'reel')).toBe(false);
  });
});
