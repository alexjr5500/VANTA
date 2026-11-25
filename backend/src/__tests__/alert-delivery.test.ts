import { AlertDelivery, alertConfig } from '../services/alert-delivery';

const env = { VANTA_ALERT_WEBHOOK_ENABLED: 'true', VANTA_ALERT_WEBHOOK_URL: 'https://alerts.example.invalid/ingest',
  VANTA_ALERT_WEBHOOK_ALLOWED_ORIGIN: 'https://alerts.example.invalid', VANTA_ALERT_WEBHOOK_TOKEN: 'synthetic-test-token-not-a-secret',
  VANTA_ALERT_ENVIRONMENT: 'staging', VANTA_ALERT_SERVICE: 'backend' };
const event = { code: 'postgres', severity: 'critical', transition: 'degraded' } as const;

describe('bounded alert delivery', () => {
  it('is opt-in and rejects insecure or unapproved destinations', () => {
    expect(alertConfig({})).toBeNull();
    expect(() => alertConfig({ ...env, VANTA_ALERT_WEBHOOK_URL: 'http://alerts.example.invalid/ingest' })).toThrow();
    expect(() => alertConfig({ ...env, VANTA_ALERT_WEBHOOK_URL: 'https://another.example.invalid/ingest' })).toThrow();
    expect(() => alertConfig({ ...env, VANTA_ALERT_WEBHOOK_URL: 'https://alerts.example.invalid/ingest?secret=bad' })).toThrow();
  });
  it('does not send when disabled', async () => {
    const fetcher = jest.fn();
    const delivery = new AlertDelivery(null, fetcher as typeof fetch);
    delivery.enqueue(event);
    await delivery.close();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('retries temporary errors with stable event IDs and excludes arbitrary metadata', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const delivery = new AlertDelivery(alertConfig(env), fetcher as typeof fetch, async () => {});
    delivery.enqueue({ ...event, privateDetail: 'do not send' } as typeof event);
    await delivery.close();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = fetcher.mock.calls[0][1];
    const second = fetcher.mock.calls[1][1];
    expect(first.redirect).toBe('error');
    expect(first.headers['idempotency-key']).toBe(second.headers['idempotency-key']);
    expect(JSON.parse(first.body)).toMatchObject({ code: 'postgres', environment: 'staging', service: 'backend' });
    expect(first.body).not.toContain('privateDetail');
    expect(first.body).not.toContain(env.VANTA_ALERT_WEBHOOK_TOKEN);
    delivery.enqueue(event);
    await delivery.flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not retry permanent rejection', async () => {
    const fetcher = jest.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const delivery = new AlertDelivery(alertConfig(env), fetcher as typeof fetch, async () => {});
    delivery.enqueue(event);
    await delivery.close();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('caps repeated temporary failures', async () => {
    const fetcher = jest.fn().mockRejectedValue(Error('private URL'));
    const delivery = new AlertDelivery(alertConfig(env), fetcher as typeof fetch, async () => {});
    delivery.enqueue(event);
    await delivery.close();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
