export async function up(knex) {
  const hasTable = await knex.schema.hasTable('password_reset_otps');
  if (!hasTable) {
    await knex.schema.createTable('password_reset_otps', (table) => {
      table.increments('id').primary();
      table
        .integer('user_id')
        .unsigned()
        .references('users.id')
        .onDelete('CASCADE')
        .index();
      table.string('code', 6).notNullable();
      table.datetime('expires_at').notNullable();
      table.integer('attempts').unsigned().notNullable().defaultTo(0);
      table.timestamps(true, true);
      table.unique(['user_id']);
    });
  }

  const now = knex.fn.now();
  const templates = [
    {
      key: 'auth.password_reset_otp',
      locale: 'en',
      subject: 'Your {{siteName}} password reset code',
      body_html: `
        <p>Hi {{name}},</p>
        <p>We received a password reset request for your {{siteName}} account.</p>
        <p>Your reset code is:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{code}}</p>
        <p>The code will expire in {{expiresInMinutes}} minutes.</p>
        <p>If you did not request this reset, you can ignore this email.</p>
      `.trim(),
      body_text:
        'Hi {{name}}, we received a password reset request. Your reset code is {{code}} and it expires in {{expiresInMinutes}} minutes.',
      description: '6 digit password reset OTP',
      enabled: true,
      created_at: now,
      updated_at: now,
    },
    {
      key: 'auth.password_reset_success',
      locale: 'en',
      subject: 'Your {{siteName}} password was updated',
      body_html: `
        <p>Hi {{name}},</p>
        <p>Your {{siteName}} password has been changed successfully.</p>
        <p>If you did not perform this action, contact support immediately.</p>
      `.trim(),
      body_text:
        'Hi {{name}}, your {{siteName}} password has been changed successfully. If this was not you, contact support immediately.',
      description: 'Password reset confirmation',
      enabled: true,
      created_at: now,
      updated_at: now,
    },
  ];

  for (const template of templates) {
    const existing = await knex('email_templates').where({ key: template.key, locale: template.locale }).first();
    if (!existing) {
      await knex('email_templates').insert(template);
    }
  }
}

export async function down(knex) {
  await knex('email_templates')
    .whereIn('key', ['auth.password_reset_otp', 'auth.password_reset_success'])
    .del();
  await knex.schema.dropTableIfExists('password_reset_otps');
}
