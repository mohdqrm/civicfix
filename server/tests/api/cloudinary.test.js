// Cloudinary driver, tested without a Cloudinary account: the signature is checked
// against the worked example in Cloudinary's own docs, and the upload request is
// checked with a fake fetch. A real upload still has to be confirmed after deploy.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let sign;
let cloudinaryDriver;

beforeAll(async () => {
  process.env.CLOUDINARY_URL = 'cloudinary://123456:abcd@demo-cloud';
  ({ sign, cloudinaryDriver } = await import('../../src/services/imageStorage.js'));
});

afterEach(() => vi.unstubAllGlobals());

describe('Cloudinary driver', () => {
  it('signs parameters exactly like Cloudinary’s documented example', () => {
    const params = {
      timestamp: 1315060510,
      public_id: 'sample_image',
      eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop',
    };
    expect(sign(params, 'abcd')).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });

  it('uploads a signed request and returns the HTTPS URL', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1/civicfix/x.webp', public_id: 'civicfix/x' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await cloudinaryDriver.save(Buffer.from('fake-webp'));
    expect(out).toEqual({ url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1/civicfix/x.webp', key: 'civicfix/x' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/upload');
    const form = init.body;
    expect(form.get('api_key')).toBe('123456');
    expect(form.get('folder')).toBe('civicfix');
    expect(form.get('api_secret')).toBeNull(); // the secret itself is never sent
    const ts = form.get('timestamp');
    expect(form.get('signature')).toBe(sign({ folder: 'civicfix', timestamp: ts }, 'abcd'));
  });

  it('turns a Cloudinary failure into a friendly 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"Invalid Signature"}}', { status: 401 })));
    await expect(cloudinaryDriver.save(Buffer.from('x'))).rejects.toMatchObject({ status: 502 });
  });
});
