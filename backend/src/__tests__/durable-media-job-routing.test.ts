import {
  excludedMediaJobTypes, LOCAL_MEDIA_JOB_TYPES, CLOUDINARY_MEDIA_JOB_TYPES,
} from '../services/durable-media-job-routing';

describe('durable media job routing', () => {
  test.each(['local', 'cloudinary'])('never claims media when handlers are disabled (%s)', mode => {
    expect(excludedMediaJobTypes(false, mode)).toEqual([
      ...LOCAL_MEDIA_JOB_TYPES, ...CLOUDINARY_MEDIA_JOB_TYPES,
    ]);
  });

  test('Cloudinary worker only claims Cloudinary media jobs', () => {
    const exclusions = excludedMediaJobTypes(true, 'cloudinary');
    expect(exclusions).toEqual([...LOCAL_MEDIA_JOB_TYPES]);
    expect(CLOUDINARY_MEDIA_JOB_TYPES.every(type => !exclusions.includes(type))).toBe(true);
  });

  test('local worker only claims local media jobs', () => {
    const exclusions = excludedMediaJobTypes(true, 'local');
    expect(exclusions).toEqual([...CLOUDINARY_MEDIA_JOB_TYPES]);
    expect(LOCAL_MEDIA_JOB_TYPES.every(type => !exclusions.includes(type))).toBe(true);
  });

  test('rejects unexpected active worker modes before queue polling', () => {
    expect(() => excludedMediaJobTypes(true, 's3')).toThrow('Unsupported durable media storage mode');
  });
});
