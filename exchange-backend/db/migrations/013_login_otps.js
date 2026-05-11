export async function up(knex) {
  await knex.schema.createTable('login_otps', (table) => {
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

export async function down(knex) {
  await knex.schema.dropTableIfExists('login_otps');
}
