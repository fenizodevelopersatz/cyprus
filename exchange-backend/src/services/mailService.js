import nodemailer from 'nodemailer';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '../db.js';
import { getSettings } from './settingsService.js';
import { getModuleLogger } from '../logging/loggers.js';

const VARIABLE_PATTERN = /{{\s*([\w.]+)\s*}}/g;

let cachedTransporter = null;
let cachedTransportKey = null;
const mailLogger = getModuleLogger('mail');
const MAIL_LOG_PATH = path.resolve('storage', 'mail-send-log.jsonl');

function isProviderRateLimitError(err) {
  const message = String(err?.message || err?.response || '').toLowerCase();
  const responseCode = Number(err?.responseCode || 0);
  return (
    responseCode === 451 ||
    message.includes('ratelimit') ||
    message.includes('rate limit') ||
    message.includes('too many') ||
    message.includes('hostinger_out_ratelimit')
  );
}

function renderTemplate(input, variables = {}) {
  if (!input) return '';
  return input.replace(VARIABLE_PATTERN, (_, token) => {
    const segments = token.split('.');
    let current = variables;
    for (const segment of segments) {
      if (current && Object.prototype.hasOwnProperty.call(current, segment)) {
        current = current[segment];
      } else {
        current = '';
        break;
      }
    }
    if (current === undefined || current === null) return '';
    return String(current);
  });
}

function transportFingerprint(settings) {
  return JSON.stringify([
    settings.mailType,
    settings.mailHost,
    settings.mailPort,
    settings.mailUsername,
    settings.mailPassword,
    settings.mailEncryption,
  ]);
}

async function resolveTransporter(settings) {
  if (!settings.mailSenderEmail) {
    throw new Error('MAIL_SENDER_NOT_CONFIGURED');
  }
  const fingerprint = transportFingerprint(settings);
  if (!cachedTransporter || cachedTransportKey !== fingerprint) {
    if (settings.mailType !== 'smtp') {
      throw new Error(`Unsupported mail type: ${settings.mailType}`);
    }
    const secure = String(settings.mailEncryption || '').toLowerCase() === 'ssl';
    cachedTransporter = nodemailer.createTransport({
      host: settings.mailHost,
      port: Number(settings.mailPort) || 587,
      secure,
      auth:
        settings.mailUsername && settings.mailPassword
          ? {
              user: settings.mailUsername,
              pass: settings.mailPassword,
            }
          : undefined,
    });
    cachedTransportKey = fingerprint;
  }
  return cachedTransporter;
}

async function appendMailLog(entry) {
  await fs.mkdir(path.dirname(MAIL_LOG_PATH), { recursive: true });
  await fs.appendFile(MAIL_LOG_PATH, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`);
}

export async function sendMail({ to, subject, html, text }) {
  const settings = await getSettings();
  const transporter = await resolveTransporter(settings);
  const fromAddress = settings.mailSenderName
    ? `${settings.mailSenderName} <${settings.mailSenderEmail}>`
    : settings.mailSenderEmail;
  const payload = { from: fromAddress, to, subject, html, text };
  try {
    const info = await transporter.sendMail(payload);
    mailLogger.info(
      {
        to,
        subject,
        messageId: info.messageId || null,
        response: info.response || null,
        envelope: info.envelope || null,
      },
      'mail_send_success'
    );
    await appendMailLog({
      status: 'sent',
      to,
      subject,
      messageId: info.messageId || null,
      response: info.response || null,
      envelope: info.envelope || null,
    });
    return info;
  } catch (err) {
    if (isProviderRateLimitError(err)) {
      err.code = err.code || 'MAIL_RATE_LIMITED';
      err.status = err.status || 503;
    }
    mailLogger.error(
      {
        err,
        to,
        subject,
      },
      'mail_send_failed'
    );
    await appendMailLog({
      status: 'failed',
      to,
      subject,
      error: err?.message || String(err),
    });
    throw err;
  }
}

export async function getTemplateByKey(key, locale = 'en') {
  const template =
    (await db('email_templates')
      .where({ key, locale, enabled: true })
      .first()) ||
    (await db('email_templates').where({ key, locale: 'en', enabled: true }).first());
  return template || null;
}

export async function sendTemplate(key, { to, locale = 'en', variables = {} } = {}) {
  const template = await getTemplateByKey(key, locale);
  if (!template) {
    throw new Error(`EMAIL_TEMPLATE_NOT_FOUND:${key}`);
  }
  const settings = await getSettings();
  const mergedVars = {
    siteName: settings.siteName,
    ...variables,
  };
  const subject = renderTemplate(template.subject, mergedVars);
  const html = renderTemplate(template.body_html, mergedVars);
  const text = template.body_text ? renderTemplate(template.body_text, mergedVars) : undefined;
  await sendMail({ to, subject, html, text });
  return { subject, html, text };
}

export async function sendRegistrationEmail({ to, name }) {
  return sendTemplate('user.register', { to, variables: { name } });
}

export async function sendLoginOtpEmail({ to, name, code, expiresInMinutes }) {
  return sendTemplate('auth.login_otp', {
    to,
    variables: { name, code, expiresInMinutes },
  });
}

export async function sendPasswordResetOtpEmail({ to, name, code, expiresInMinutes }) {
  return sendTemplate('auth.password_reset_otp', {
    to,
    variables: { name, code, expiresInMinutes },
  });
}

export async function sendPasswordResetSuccessEmail({ to, name }) {
  return sendTemplate('auth.password_reset_success', {
    to,
    variables: { name },
  });
}

export async function sendStripeDepositSuccessEmail({
  to,
  name,
  amount,
  currency,
  wallet,
  reference,
}) {
  return sendTemplate('payments.stripe_success', {
    to,
    variables: { name, amount, currency, wallet, reference },
  });
}

export async function sendStripeDepositFailureEmail({
  to,
  name,
  amount,
  currency,
  status,
  reason,
}) {
  return sendTemplate('payments.stripe_failed', {
    to,
    variables: { name, amount, currency, status, reason },
  });
}

export async function sendSpotTradeEmail({ to, name, symbol, side, price, quantity, fee, feeAsset }) {
  return sendTemplate('trade.spot_execution', {
    to,
    variables: { name, symbol, side, price, quantity, fee, feeAsset },
  });
}

export async function sendFuturesTradeEmail({
  to,
  name,
  symbol,
  side,
  price,
  quantity,
}) {
  return sendTemplate('trade.futures_execution', {
    to,
    variables: { name, symbol, side, price, quantity },
  });
}

export async function sendAccountDeletedEmail({ to, name }) {
  return sendTemplate('account.deleted', { to, variables: { name } });
}

export async function sendPriceAlertEmail({ to, name, symbol, price, alertName }) {
  return sendTemplate('alerts.price_triggered', {
    to,
    variables: { name, symbol, price, alertName },
  });
}

export async function sendKycApprovedEmail({ to, name, submittedAt }) {
  return sendTemplate('kyc.approved', { to, variables: { name, submittedAt } });
}

export async function sendKycSubmissionEmail({ to, name, submittedAt }) {
  return sendTemplate('kyc.requested', { to, variables: { name, submittedAt } });
}

export { isProviderRateLimitError };
