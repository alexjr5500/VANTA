import type Stripe from 'stripe';
import { isStripeTestCheckoutUrl, validatePaidCardSession } from '../services/shop-card.service';

jest.mock('../prisma', () => ({ prisma: {} }));
jest.mock('../services/wallet.service', () => ({ walletService: {} }));
jest.mock('../services/verification-payment.service', () => ({ verificationPaymentService: {} }));

const card = { id: 'checkout1', orderId: 'order1', product: 'coins', sessionId: 'cs_test_abc', amountCents: 500 };
const meta = { vantaCheckoutId: card.id, vantaOrderId: card.orderId };
function session(): Stripe.Checkout.Session {
  return {
    id: card.sessionId, livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 500,
    client_reference_id: card.id, metadata: { ...meta, product: card.product },
    payment_intent: {
      id: 'pi_123', livemode: false, status: 'succeeded', currency: 'usd', amount: 500, amount_received: 500, metadata: meta,
      latest_charge: { livemode: false, paid: true, captured: true, refunded: false, amount_refunded: 0, disputed: false, amount: 500, currency: 'usd' },
    },
  } as unknown as Stripe.Checkout.Session;
}
describe('Stripe paid checkout proof', () => {
  test('accepts only the bound, fully paid test session', () => {
    expect(validatePaidCardSession(card, session())).toBe('pi_123');
  });
  test.each([
    { livemode: true }, { id: 'cs_test_other' }, { amount_total: 1 },
    { payment_status: 'unpaid' }, { currency: 'eur' }, { client_reference_id: 'another-user' },
    { metadata: { ...meta, product: 'badge' } }, { payment_intent: 'pi_unexpanded' },
  ])('rejects mismatched or incomplete session %j', patch => {
    expect(() => validatePaidCardSession(card, { ...session(), ...patch } as Stripe.Checkout.Session)).toThrow();
  });
  test.each([{ refunded: true }, { amount_refunded: 1 }, { disputed: true }, { captured: false }, { paid: false }])('rejects invalid charge %j', patch => {
    const s = session();
    const intent = s.payment_intent as Stripe.PaymentIntent;
    intent.latest_charge = { ...(intent.latest_charge as Stripe.Charge), ...patch };
    expect(() => validatePaidCardSession(card, s)).toThrow();
  });
  test('accepts only official hosted test checkout URLs', () => {
    expect(isStripeTestCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_abc')).toBe(true);
    for (const url of ['https://checkout.stripe.com.evil.test/c/pay/cs_test_abc', 'https://checkout.stripe.com/c/pay/cs_live_abc', 'http://checkout.stripe.com/c/pay/cs_test_abc', 'https://evil.test/c/pay/cs_test_abc']) expect(isStripeTestCheckoutUrl(url)).toBe(false);
  });
});
