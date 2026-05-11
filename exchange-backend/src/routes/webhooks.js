import express from 'express';
import crypto from 'crypto';
import { processCheckoutSessionWebhook } from '../services/fiatFundingService.js';

const router = express.Router();

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) {
    throw new Error('SIGNATURE_MISSING');
  }
  const parts = signatureHeader.split(',').map((part) => part.split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signature = parts.find(([key]) => key === 'v1')?.[1];
  if (!timestamp || !signature) {
    throw new Error('SIGNATURE_MALFORMED');
  }
  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error('SIGNATURE_MISMATCH');
  }
}

router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(501).json({ message: 'Stripe webhook disabled' });
    }
    try {
      const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : req.body;
      verifyStripeSignature(rawBody, req.headers['stripe-signature'], secret);
      const event = JSON.parse(rawBody);
      const session = event?.data?.object;

      switch (event?.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
        case 'checkout.session.expired':
        case 'checkout.session.async_payment_failed':
          await processCheckoutSessionWebhook(session);
          break;
        default:
          break;
      }
      res.json({ received: true });
    } catch (err) {
      console.error('[stripe webhook] error', err.message);
      res.status(400).json({ message: 'Webhook Error', error: err.message });
    }
  }
);

export default router;

