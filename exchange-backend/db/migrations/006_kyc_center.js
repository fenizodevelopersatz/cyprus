// db/migrations/006_kyc_center.js
export async function up(knex){
  await knex.schema.createTable('kyc_documents', (t) => {
    t.increments('id').primary();
    t.uuid('submission_id').notNullable();
    t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
    t.string('document_type').notNullable();
    t.string('original_filename');
    t.string('stored_filename').notNullable();
    t.string('mime_type');
    t.boolean('is_secondary').defaultTo(false);
    t.bigInteger('size').unsigned();
    t.string('status').defaultTo('IN_REVIEW');
    t.text('notes');
    t.integer('reviewer_id').unsigned().references('users.id');
    t.datetime('reviewed_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('kyc_activity', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
    t.string('event').notNullable();
    t.text('message');
    t.json('metadata');
    t.timestamps(true, true);
  });

  await knex.schema.alterTable('kyc_requests', (t) => {
    t.string('submission_id');
    t.boolean('resubmission_required').defaultTo(false);
    t.text('notes');
  });
}

export async function down(knex){
  await knex.schema.alterTable('kyc_requests', (t) => {
    t.dropColumn('notes');
    t.dropColumn('resubmission_required');
    t.dropColumn('submission_id');
  });
  await knex.schema.dropTableIfExists('kyc_activity');
  await knex.schema.dropTableIfExists('kyc_documents');
}
