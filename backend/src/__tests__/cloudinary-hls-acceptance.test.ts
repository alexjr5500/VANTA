import { verifyPublicCloudinaryHls } from '../services/cloudinary-hls-acceptance';

const base = 'https://res.cloudinary.com/test-cloud/video/upload/sp_hd/vanta/reel/clip';
const master = base + '.m3u8';
const variant = 'https://res.cloudinary.com/test-cloud/video/upload/sp_hd/vanta/reel/360p.m3u8';
const segment = 'https://res.cloudinary.com/test-cloud/video/upload/sp_hd/vanta/reel/segment-00001.ts';

const playlist = (text: string, status = 200) => new Response(text, {
  status, headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
});
function mockFetch(overrides: Record<string, Response> = {}) {
  const defaults: Record<string, Response> = {
    [master]: playlist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n360p.m3u8\n'),
    [variant]: playlist('#EXTM3U\n#EXTINF:3.0,\nsegment-00001.ts\n#EXT-X-ENDLIST\n'),
    [segment]: new Response(Uint8Array.from([0x47, 0x40, 0x00, 0x10]), {
      status: 206, headers: { 'Content-Type': 'video/mp2t' },
    }),
  };
  const resources = { ...defaults, ...overrides };
  return jest.fn(async (url: string, options: RequestInit) => {
    expect(options.redirect).toBe('manual');
    expect(options.method).toBe('GET');
    return resources[url] || new Response('Not found', { status: 404 });
  });
}

describe('read-only Cloudinary HLS staging acceptance', () => {
  test('verifies master, variant playlist, and actual transport-stream bytes', async () => {
    const fetcher = mockFetch();
    await expect(verifyPublicCloudinaryHls(master, 'test-cloud', fetcher))
      .resolves.toEqual({ variantsChecked: 1, segmentsChecked: 1 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test.each([
    'http://res.cloudinary.com/test-cloud/video/upload/sp_hd/vanta/reel/clip.m3u8',
    'https://evil.example/test-cloud/video/upload/sp_hd/vanta/reel/clip.m3u8',
    'https://res.cloudinary.com/other-cloud/video/upload/sp_hd/vanta/reel/clip.m3u8',
    'https://res.cloudinary.com/test-cloud/video/authenticated/sp_hd/vanta/reel/clip.m3u8',
    master + '?token=secret',
  ])('rejects an untrusted or private initial URL', async url => {
    const fetcher = mockFetch();
    await expect(verifyPublicCloudinaryHls(url, 'test-cloud', fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('rejects an external variant before fetching it', async () => {
    const fetcher = mockFetch({ [master]: playlist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://evil.example/x.m3u8\n') });
    await expect(verifyPublicCloudinaryHls(master, 'test-cloud', fetcher))
      .rejects.toThrow('expected public Cloudinary account');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('rejects an external segment before fetching it', async () => {
    const fetcher = mockFetch({
      [variant]: playlist('#EXTM3U\n#EXTINF:3.0,\nhttps://evil.example/segment.ts\n#EXT-X-ENDLIST\n'),
    });
    await expect(verifyPublicCloudinaryHls(master, 'test-cloud', fetcher))
      .rejects.toThrow('expected public Cloudinary account');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('rejects incomplete HLS variants and missing segments', async () => {
    const noEnd = mockFetch({ [variant]: playlist('#EXTM3U\n#EXTINF:3.0,\nsegment-00001.ts\n') });
    await expect(verifyPublicCloudinaryHls(master, 'test-cloud', noEnd))
      .rejects.toThrow('missing ENDLIST');

    const missing = mockFetch({ [segment]: new Response('Missing', { status: 404 }) });
    await expect(verifyPublicCloudinaryHls(master, 'test-cloud', missing))
      .rejects.toThrow('HTTP 404');
  });

  test('rejects empty and non-media segment responses', async () => {
    const fetcher = mockFetch({ [segment]: new Response('Not TS', { status: 200 }) });
    await expect(verifyPublicCloudinaryHls(master, 'test-cloud', fetcher))
      .rejects.toThrow('not valid transport-stream');
  });

  test('rejects redirect responses instead of following them', async () => {
    const fetcher = mockFetch({ [master]: new Response(null, {
      status: 302, headers: { Location: 'https://evil.example/redirect.m3u8' },
    }) });
    await expect(verifyPublicCloudinaryHls(master, 'test-cloud', fetcher))
      .rejects.toThrow('HTTP 302');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('rejects malformed master playlists and fake HTML endpoints', async () => {
    const malformed = mockFetch({ [master]: playlist('<html>bad</html>') });
    await expect(verifyPublicCloudinaryHls(master, 'test-cloud', malformed))
      .rejects.toThrow('required header');
    const html = mockFetch({ [master]: new Response('<html>bad</html>', {
      status: 200, headers: { 'Content-Type': 'text/html' },
    }) });
    await expect(verifyPublicCloudinaryHls(master, 'test-cloud', html))
      .rejects.toThrow('did not return');
  });
});
