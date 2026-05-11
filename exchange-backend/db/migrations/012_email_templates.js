const TEMPLATE_SETS = [
  {
    key: 'user.register',
    subject: 'Welcome to {{siteName}}',
    html: `
      <p>Hi {{name}},</p>
      <p>Welcome to {{siteName}}. Your account is now active and you can start trading right away.</p>
      <p>If you did not create this account, please contact support immediately.</p>
      <p>— The {{siteName}} Team</p>
    `,
    text: `Hi {{name}},

Welcome to {{siteName}}. Your account is ready to use.

— The {{siteName}} Team`,
    description: 'Sent after successful registration',
  },
  {
    key: 'auth.login_otp',
    subject: 'Your {{siteName}} login code',
    html: `
      <p>Hi {{name}},</p>
      <p>Your one-time login code is:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{code}}</p>
      <p>The code will expire in {{expiresInMinutes}} minutes.</p>
    `,
    text: `Hi {{name}}, your one-time login code is {{code}} (expires in {{expiresInMinutes}} minutes).`,
    description: '6 digit login OTP',
  },
  {
    key: 'payments.stripe_success',
    subject: 'Fiat deposit confirmed',
    html: `
      <p>Hi {{name}},</p>
      <p>Your Stripe deposit of {{amount}} {{currency}} was successful. The funds have been credited to your {{wallet}} wallet.</p>
      <p>Reference: {{reference}}</p>
    `,
    text: `Your Stripe deposit of {{amount}} {{currency}} succeeded. Wallet: {{wallet}}. Reference: {{reference}}.`,
    description: 'Stripe deposit success',
  },
  {
    key: 'payments.stripe_failed',
    subject: 'Fiat deposit failed',
    html: `
      <p>Hi {{name}},</p>
      <p>Your recent Stripe deposit of {{amount}} {{currency}} could not be completed.</p>
      <p>Status: {{status}}<br/>Reason: {{reason}}</p>
      <p>Please try again or contact support.</p>
    `,
    text: `Stripe deposit of {{amount}} {{currency}} failed ({{status}}: {{reason}}).`,
    description: 'Stripe deposit failure',
  },
  {
    key: 'trade.spot_execution',
    subject: 'Spot trade filled — {{symbol}}',
    html: `
      <p>Hi {{name}},</p>
      <p>Your {{side}} order for {{symbol}} was filled at {{price}}. Filled size: {{quantity}}.</p>
      <p>Fee: {{fee}} {{feeAsset}}</p>
    `,
    text: `Spot trade filled: {{side}} {{symbol}} at {{price}} (size {{quantity}}). Fee: {{fee}} {{feeAsset}}.`,
    description: 'Spot execution notice',
  },
  {
    key: 'trade.futures_execution',
    subject: 'Futures trade update — {{symbol}}',
    html: `
      <p>Hi {{name}},</p>
      <p>Your futures {{side}} order for {{symbol}} was executed at {{price}}.</p>
      <p>Filled size: {{quantity}} contracts.</p>
    `,
    text: `Futures trade executed: {{side}} {{symbol}} at {{price}} (size {{quantity}} contracts).`,
    description: 'Futures execution notice',
  },
  {
    key: 'account.deleted',
    subject: 'Your {{siteName}} account has been removed',
    html: `
      <p>Hi {{name}},</p>
      <p>This is a confirmation that your account has been scheduled for deletion.</p>
      <p>If you did not request this, contact support immediately.</p>
    `,
    text: `Account deletion confirmed for {{name}}.`,
    description: 'Delete account confirmation',
  },
  {
    key: 'alerts.price_triggered',
    subject: 'Price alert — {{symbol}} reached {{price}}',
    html: `
      <p>Hi {{name}},</p>
      <p>The price alert for {{symbol}} was triggered at {{price}}.</p>
      <p>Alert name: {{alertName}}</p>
    `,
    text: `Price alert for {{symbol}} triggered at {{price}} ({{alertName}}).`,
    description: 'Price alert notification',
  },
  {
    key: 'kyc.approved',
    subject: 'KYC approved',
    html: `
      <p>Hi {{name}},</p>
      <p>Your KYC request submitted on {{submittedAt}} has been approved. You now have full access to all features.</p>
    `,
    text: `Your KYC request submitted on {{submittedAt}} has been approved.`,
    description: 'KYC approval notice',
  },
  {
    key: 'kyc.requested',
    subject: 'KYC submission received',
    html: `
      <p>Hi {{name}},</p>
      <p>We received your KYC submission on {{submittedAt}}. Our compliance team will review it shortly and notify you about the result.</p>
    `,
    text: `We received your KYC submission on {{submittedAt}}.`,
    description: 'KYC submission acknowledgment',
  },
];

export async function up(knex) {
  await knex.schema.createTable('email_templates', (table) => {
    table.increments('id').primary();
    table.string('key', 128).notNullable().unique();
    table.string('locale', 16).notNullable().defaultTo('en');
    table.string('subject', 255).notNullable();
    table.text('body_html').notNullable();
    table.text('body_text');
    table.string('description', 255);
    table.boolean('enabled').notNullable().defaultTo(true);
    table.timestamps(true, true);
    table.index(['key', 'locale']);
  });

  const now = knex.fn.now();
  await knex('email_templates').insert(
    TEMPLATE_SETS.map((tpl) => ({
      key: tpl.key,
      locale: 'en',
      subject: tpl.subject.trim(),
      body_html: tpl.html.trim(),
      body_text: tpl.text ? tpl.text.trim() : null,
      description: tpl.description || null,
      enabled: true,
      created_at: now,
      updated_at: now,
    }))
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('email_templates');
}
