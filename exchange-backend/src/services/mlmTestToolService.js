import { db, withTx } from '../db.js';
import { hashPassword } from '../utils/crypto.js';
import { ensureReferralProfile, ensureReferralStats, recordReferralSignup } from './referralService.js';
import { provisionUserWallets, listUserWallets } from './userWalletService.js';
import { creditDeposit } from './ledgerService.js';
import { recalculateAllMlmSummaries, ensureMlmLevelSchema, getUserMlmDashboard } from './mlmLevelService.js';

let schemaReadyPromise = null;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toAmount(value) {
  return toNumber(value, 0).toFixed(18);
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sample(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function chance(percent) {
  return Math.random() * 100 < percent;
}

function randomInt(min, max) {
  const safeMin = Math.ceil(Number(min) || 0);
  const safeMax = Math.floor(Number(max) || 0);
  if (safeMax <= safeMin) return safeMin;
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

async function ensureSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureMlmLevelSchema().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
}

function userEligible(user, minimumEligibleBalance) {
  return String(user.status).toLowerCase() === 'active' && toNumber(user.main_wallet_balance) >= minimumEligibleBalance;
}

function buildTree({ totalUsers, maxTreeDepth, maxDirectChildren, activeRatio }) {
  const users = [];
  users.push({ testUserNo: 1, sponsorTestUserNo: null, depth: 0 });

  for (let i = 2; i <= totalUsers; i += 1) {
    const candidates = users.filter((user) => user.depth < maxTreeDepth);
    const sponsor = sample(candidates.length ? candidates : users);
    const siblingCount = users.filter((user) => user.sponsorTestUserNo === sponsor.testUserNo).length;
    if (siblingCount >= maxDirectChildren) {
      const fallback =
        users.find(
          (user) =>
            user.depth < maxTreeDepth &&
            users.filter((item) => item.sponsorTestUserNo === user.testUserNo).length < maxDirectChildren
        ) || sponsor;
      users.push({ testUserNo: i, sponsorTestUserNo: fallback.testUserNo, depth: fallback.depth + 1 });
    } else {
      users.push({ testUserNo: i, sponsorTestUserNo: sponsor.testUserNo, depth: sponsor.depth + 1 });
    }
  }

  return users.map((user) => ({
    ...user,
    fullName: `u${user.testUserNo}`,
    email: `u${user.testUserNo}@example.test`,
    phone: `900000${String(user.testUserNo).padStart(4, '0')}`,
    country: 'Testland',
    status: chance(activeRatio) ? 'active' : 'inactive',
  }));
}

function makeDepositPlan({ minDeposit, maxDeposit, minimumEligibleBalance, multipleDeposits, forceEligible }) {
  const safeMin = Math.max(1, Number(minDeposit) || 1);
  const safeMax = Math.max(safeMin, Number(maxDeposit) || safeMin);
  const threshold = Math.max(Number(minimumEligibleBalance) || 300, 1);

  if (forceEligible) {
    const lowerBound = Math.min(Math.max(threshold, safeMin), safeMax);
    const firstDeposit = randomInt(lowerBound, safeMax);
    const extraCount = multipleDeposits ? randomInt(0, 2) : 0;
    const amounts = [firstDeposit];
    for (let i = 0; i < extraCount; i += 1) amounts.push(randomInt(safeMin, safeMax));
    return amounts;
  }

  const depositCount = multipleDeposits ? randomInt(0, 3) : randomInt(0, 1);
  const amounts = [];
  for (let i = 0; i < depositCount; i += 1) amounts.push(randomInt(safeMin, safeMax));
  return amounts;
}

async function getNextRunId(trx = db) {
  const row = await trx('users').where({ is_test_user: true }).max({ maxRunId: 'test_run_id' }).first();
  return Math.max(toNumber(row?.maxRunId), 0) + 1;
}

async function cleanupRunUsers(runId, trx) {
  const users = await trx('users').select('id').where({ is_test_user: true, test_run_id: runId });
  const userIds = users.map((row) => Number(row.id));
  if (!userIds.length) return;
  await trx('users').whereIn('id', userIds).del();
}

async function createSeedUser(trx, payload) {
  const now = new Date();
  const passwordHash = await hashPassword('Qwerty@123');
  const inserted = await trx('users').insert({
    email: payload.email,
    password_hash: passwordHash,
    country: payload.country,
    kyc_level: 0,
    kyc_verified: payload.status === 'active',
    sponsor_id: null,
    status: payload.status,
    current_level_rank: 0,
    is_test_user: true,
    test_run_id: payload.runId,
    main_wallet_balance: '0',
    created_at: now,
    updated_at: now,
  });
  const id = Array.isArray(inserted) ? inserted[0] : inserted;

  await trx('user_profiles').insert({
    user_id: id,
    display_name: payload.fullName,
    country: payload.country,
    tier: 'test-seed',
  });

  for (const type of ['spot', 'margin', 'futures', 'p2p_escrow']) {
    await trx('wallets').insert({ user_id: id, type, asset: 'USDT', balance: 0 });
  }

  await ensureReferralProfile(id, { trx });
  await ensureReferralStats(id, { trx });
  await provisionUserWallets(id, { trx });

  return id;
}

async function createSeedDepositsForUser(trx, { userId, runId, amounts }) {
  const networks = ['ERC20', 'BEP20', 'TRC20'];
  const walletRows = await listUserWallets(userId, { trx });
  const walletByNetwork = new Map(walletRows.map((row) => [row.network, row]));
  const now = new Date();
  let total = 0;

  for (let index = 0; index < amounts.length; index += 1) {
    const amount = amounts[index];
    const network = sample(networks);
    const wallet = walletByNetwork.get(network);
    const txHash = `seed-${runId}-${userId}-${network}-${Date.now()}-${index + 1}`;
    const chain = network;
    const networkKey = network === 'ERC20' ? 'ethereum' : network === 'BEP20' ? 'bsc' : 'tron';

    await trx('deposits').insert({
      user_id: userId,
      chain,
      network_key: networkKey,
      asset: 'USDT',
      token_key: 'usdt',
      tx_hash: txHash,
      amount: toAmount(amount),
      confirmations: 30,
      confirmation_target: 20,
      status: 'credited',
      credited: true,
      confirmed_at: now,
      credited_at: now,
      first_seen_at: now,
      last_seen_at: now,
      last_checked_at: now,
      from_address: `seed-from-${runId}-${userId}-${index + 1}`,
      to_address: wallet?.address || null,
      source: 'mlm_test_tool',
      created_at: now,
      updated_at: now,
    });

    await creditDeposit(userId, 'USDT', toAmount(amount), trx);
    total += amount;
  }

  return total;
}

async function buildResults(runId) {
  const users = await db('users')
    .where({ is_test_user: true, test_run_id: runId })
    .select(
      'id',
      'email',
      'status',
      'sponsor_id',
      'main_wallet_balance',
      'current_level_code',
      'current_level_rank',
      'created_at'
    )
    .orderBy('id', 'asc');

  if (!users.length) return null;
  const dashboardConfig = await getUserMlmDashboard(Number(users[0].id));
  const minimumEligibleBalance = Math.max(1, toNumber(dashboardConfig?.minimumEligibleBalance, 300));

  const userIds = users.map((row) => Number(row.id));
  const [profiles, summaries, deposits, achievements, payouts, incomeRows] = await Promise.all([
    db('user_profiles').whereIn('user_id', userIds),
    db('user_team_wallet_summary').whereIn('user_id', userIds),
    db('deposits').whereIn('user_id', userIds).orderBy([{ column: 'user_id', order: 'asc' }, { column: 'created_at', order: 'asc' }]),
    db('mlm_level_achievements').whereIn('user_id', userIds).orderBy([{ column: 'user_id', order: 'asc' }, { column: 'level_rank', order: 'asc' }]),
    db('mlm_level_bonus_payouts').whereIn('user_id', userIds).orderBy([{ column: 'user_id', order: 'asc' }, { column: 'created_at', order: 'desc' }]),
    db('mlm_income_history').whereIn('user_id', userIds).where({ status: 'SUCCESS' }),
  ]);

  const profileMap = new Map(profiles.map((row) => [Number(row.user_id), row]));
  const summaryMap = new Map(summaries.map((row) => [Number(row.user_id), row]));
  const depositsMap = new Map();
  const achievementsMap = new Map();
  const payoutsMap = new Map();
  const incomeMap = new Map();

  for (const row of deposits) {
    const key = Number(row.user_id);
    if (!depositsMap.has(key)) depositsMap.set(key, []);
    depositsMap.get(key).push({
      id: row.id,
      amount: String(row.amount),
      txHash: row.tx_hash,
      chain: row.chain,
      status: row.status,
      createdAt: row.created_at,
    });
  }

  for (const row of achievements) {
    const key = Number(row.user_id);
    if (!achievementsMap.has(key)) achievementsMap.set(key, []);
    achievementsMap.get(key).push({
      id: row.id,
      levelCode: row.level_code,
      rewardAmount: String(row.promotion_reward_amount || '0'),
      achievedAt: row.achieved_at,
    });
  }

  for (const row of payouts) {
    const key = Number(row.user_id);
    if (!payoutsMap.has(key)) payoutsMap.set(key, []);
    const meta = parseJson(row.meta, {});
    payoutsMap.get(key).push({
      id: row.id,
      levelCode: row.level_code,
      eligibleBalance: String(row.eligible_balance || '0'),
      eligibleMembers: toNumber(row.eligible_members),
      qualifiedDirectMembers: toNumber(row.qualified_direct_members),
      actualEligibleBalance: String(meta?.actualEligibleBalance || row.eligible_balance || '0'),
      minimumEligibleBalance: String(meta?.minimumEligibleBalance || '0'),
      payoutEligibleBalance: String(meta?.payoutEligibleBalance || row.eligible_balance || '0'),
      bonusBase: String(meta?.bonusBase || 'team'),
      payoutAmount: String(row.payout_amount || '0'),
      status: row.status,
      createdAt: row.created_at,
    });
  }

  for (const row of incomeRows) {
    const key = Number(row.user_id);
    if (!incomeMap.has(key)) incomeMap.set(key, 0);
    incomeMap.set(key, incomeMap.get(key) + toNumber(row.amount));
  }

  const userMap = new Map(users.map((user) => [Number(user.id), user]));
  const depthMemo = new Map();
  const getDepth = (userId) => {
    if (depthMemo.has(userId)) return depthMemo.get(userId);
    const user = userMap.get(userId);
    const sponsorId = user?.sponsor_id ? Number(user.sponsor_id) : 0;
    const depth = sponsorId && userMap.has(sponsorId) ? getDepth(sponsorId) + 1 : 0;
    depthMemo.set(userId, depth);
    return depth;
  };

  return {
    run: {
      id: runId,
      mode: 'real-users',
      createdAt: users[0]?.created_at || null,
      updatedAt: new Date().toISOString(),
    },
    users: users.map((user) => {
      const profile = profileMap.get(Number(user.id));
      const summary = summaryMap.get(Number(user.id));
      return {
        id: user.id,
        testUserNo: Number(user.id),
        fullName: profile?.display_name || user.email,
        email: user.email,
        phone: profile?.phone || null,
        sponsorId: user.sponsor_id ? Number(user.sponsor_id) : null,
        depth: getDepth(Number(user.id)),
        status: user.status,
        wallet: String(user.main_wallet_balance || '0'),
        individualBalance: String(
          (depositsMap.get(Number(user.id)) || []).reduce((sum, deposit) => sum + toNumber(deposit.amount), 0)
        ),
        downlineTotalBalance: String(summary?.team_total_balance || '0'),
        eligibleTeamBalance: String(summary?.team_eligible_balance || '0'),
        minimumEligibleTeamBalance: toAmount(toNumber(summary?.team_eligible_members) * minimumEligibleBalance),
        directTotalBalance: String(summary?.direct_total_balance || '0'),
        directTotalMembers: toNumber(summary?.direct_total_members),
        directEligibleMembers: toNumber(summary?.direct_eligible_members),
        teamTotalMembers: toNumber(summary?.team_total_members),
        teamEligibleMembers: toNumber(summary?.team_eligible_members),
        achievedLevel: user.current_level_code || null,
        nextLevelPossible: null,
        promotionRewardApplicable: (achievementsMap.get(Number(user.id)) || []).length > 0,
        bonusEligible: (payoutsMap.get(Number(user.id)) || []).length > 0,
        simulatedPromotionReward: String((achievementsMap.get(Number(user.id)) || []).slice(-1)[0]?.rewardAmount || '0'),
        simulatedBonusAmount: String((payoutsMap.get(Number(user.id)) || [])[0]?.payoutAmount || '0'),
        depositHistory: depositsMap.get(Number(user.id)) || [],
        promotionHistory: achievementsMap.get(Number(user.id)) || [],
        bonusPayoutHistory: payoutsMap.get(Number(user.id)) || [],
        mlmIncomeTotal: toAmount(incomeMap.get(Number(user.id)) || 0),
      };
    }),
  };
}

export async function generateTestRun({
  totalUsers = 100,
  maxTreeDepth = 3,
  maxDirectChildren = 4,
  activeRatio = 70,
  minDeposit = 1,
  maxDeposit = 600,
  minimumEligibleBalance = 300,
  minimumGuaranteedEligibleUsers = 10,
  multipleDeposits = true,
} = {}) {
  await ensureSchema();

  const runId = await getNextRunId();
  const safeTotalUsers = Math.max(1, Number(totalUsers) || 100);
  const tree = buildTree({
    totalUsers: safeTotalUsers,
    maxTreeDepth: Math.max(1, Number(maxTreeDepth) || 3),
    maxDirectChildren: Math.max(1, Number(maxDirectChildren) || 4),
    activeRatio: Math.min(Math.max(Number(activeRatio) || 70, 0), 100),
  });

  const guaranteedEligible = new Set(
    tree
      .slice()
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(safeTotalUsers, Math.max(0, Number(minimumGuaranteedEligibleUsers) || 10)))
      .map((user) => user.testUserNo)
  );

  const userIdMap = new Map();

  await withTx(async (trx) => {
    for (const user of tree) {
      if (guaranteedEligible.has(user.testUserNo)) user.status = 'active';
      const createdId = await createSeedUser(trx, { ...user, runId });
      userIdMap.set(user.testUserNo, createdId);
    }

    for (const user of tree) {
      const sponsorId = user.sponsorTestUserNo ? userIdMap.get(user.sponsorTestUserNo) : null;
      await trx('users').where({ id: userIdMap.get(user.testUserNo) }).update({
        sponsor_id: sponsorId || null,
        updated_at: new Date(),
      });
      if (sponsorId) {
        await recordReferralSignup({
          inviterUserId: sponsorId,
          email: user.email,
          status: 'joined',
          joinedAt: new Date(),
          trx,
        });
      }
    }

    for (const user of tree) {
      const amounts = makeDepositPlan({
        minDeposit,
        maxDeposit,
        minimumEligibleBalance,
        multipleDeposits,
        forceEligible: guaranteedEligible.has(user.testUserNo),
      });
      await createSeedDepositsForUser(trx, {
        userId: userIdMap.get(user.testUserNo),
        runId,
        amounts,
      });
    }
  });

  await recalculateAllMlmSummaries();
  return buildResults(runId);
}

export async function generateDummyDeposits(runId, { minDeposit = 1, maxDeposit = 600, multipleDeposits = true } = {}) {
  await ensureSchema();
  const users = await db('users')
    .where({ is_test_user: true, test_run_id: Number(runId) })
    .select('id', 'status')
    .orderBy('id', 'asc');
  if (!users.length) return null;

  await withTx(async (trx) => {
    for (const user of users) {
      const amounts = makeDepositPlan({
        minDeposit,
        maxDeposit,
        minimumEligibleBalance: 300,
        multipleDeposits,
        forceEligible: String(user.status).toLowerCase() === 'active' && toNumber(user.id) % 10 === 0,
      });
      await createSeedDepositsForUser(trx, {
        userId: Number(user.id),
        runId: Number(runId),
        amounts,
      });
    }
  });

  await recalculateAllMlmSummaries();
  return buildResults(Number(runId));
}

export async function rebuildTestTree(runId, { maxTreeDepth = 3, maxDirectChildren = 4 } = {}) {
  await ensureSchema();
  const users = await db('users')
    .where({ is_test_user: true, test_run_id: Number(runId) })
    .select('id', 'email', 'status')
    .orderBy('id', 'asc');
  if (!users.length) return null;

  const rebuilt = buildTree({
    totalUsers: users.length,
    maxTreeDepth: Math.max(1, Number(maxTreeDepth) || 3),
    maxDirectChildren: Math.max(1, Number(maxDirectChildren) || 4),
    activeRatio: 100,
  });

  const orderedIds = users.map((user) => Number(user.id));
  const byTestNo = new Map(rebuilt.map((item, index) => [item.testUserNo, orderedIds[index]]));

  await withTx(async (trx) => {
    for (const item of rebuilt) {
      await trx('users')
        .where({ id: byTestNo.get(item.testUserNo) })
        .update({
          sponsor_id: item.sponsorTestUserNo ? byTestNo.get(item.sponsorTestUserNo) : null,
          updated_at: new Date(),
        });
    }
  });

  await recalculateAllMlmSummaries();
  return buildResults(Number(runId));
}

export async function recalculateTestRun(runId) {
  await ensureSchema();
  const exists = await db('users').where({ is_test_user: true, test_run_id: Number(runId) }).first();
  if (!exists) return null;
  await recalculateAllMlmSummaries();
  return buildResults(Number(runId));
}

export async function getTestRunResults(runId = null) {
  await ensureSchema();
  const selectedRunId =
    runId !== null && runId !== undefined
      ? Number(runId)
      : toNumber((await db('users').where({ is_test_user: true }).max({ maxRunId: 'test_run_id' }).first())?.maxRunId, 0);
  if (!selectedRunId) return null;
  return buildResults(selectedRunId);
}

export async function resetTestRuns() {
  await ensureSchema();
  return withTx(async (trx) => {
    const runIds = await trx('users')
      .where({ is_test_user: true })
      .distinct('test_run_id')
      .orderBy('test_run_id', 'asc');

    for (const row of runIds) {
      await cleanupRunUsers(Number(row.test_run_id), trx);
    }

    return { ok: true };
  });
}

export async function getSeededUserMlmDashboard(userId) {
  return getUserMlmDashboard(userId);
}
