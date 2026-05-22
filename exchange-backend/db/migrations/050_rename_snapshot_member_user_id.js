export async function up(knex) {
  const hasMembersTable = await knex.schema.hasTable('mlm_bonus_cycle_snapshot_members');
  if (!hasMembersTable) return;

  const hasUserId = await knex.schema.hasColumn('mlm_bonus_cycle_snapshot_members', 'user_id');
  const hasMemberUserId = await knex.schema.hasColumn('mlm_bonus_cycle_snapshot_members', 'member_user_id');

  if (!hasUserId && hasMemberUserId) {
    try {
      await knex.schema.alterTable('mlm_bonus_cycle_snapshot_members', (table) => {
        table.renameColumn('member_user_id', 'user_id');
      });
    } catch {}
  }
}

export async function down(knex) {
  const hasMembersTable = await knex.schema.hasTable('mlm_bonus_cycle_snapshot_members');
  if (!hasMembersTable) return;

  const hasUserId = await knex.schema.hasColumn('mlm_bonus_cycle_snapshot_members', 'user_id');
  const hasMemberUserId = await knex.schema.hasColumn('mlm_bonus_cycle_snapshot_members', 'member_user_id');

  if (hasUserId && !hasMemberUserId) {
    try {
      await knex.schema.alterTable('mlm_bonus_cycle_snapshot_members', (table) => {
        table.renameColumn('user_id', 'member_user_id');
      });
    } catch {}
  }
}
