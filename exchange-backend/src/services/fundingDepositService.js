import { db, withTx } from '../db.js';
import { journal } from './ledgerService.js';
import { getUserWalletByNetwork, listUserWallets } from './userWalletService.js';
import { canGiveJoinReward } from './incomeValidator.js';
import { applyWalletCreditRecord } from './walletAccountingService.js';
import { getLevelManagementSettings } from './adminLevelManagement.service.js';

const NETWORK_KEYS = ['ethereum', 'bsc', 'tron'];
const STATUS_KEYS = ['detected', 'pending', 'confirmed', 'credited'];
const NETWORK_TO_WALLET = {
  ethereum: 'ERC20',
  bsc: 'BEP20',
  tron: 'TRC20',
};
const DEFAULT_CONFIRMATIONS = {
  ethereum: Number(process.env.ETH_USDT_CONFIRMATIONS || process.env.ETH_CONFIRMATIONS || 12),
  bsc: Number(process.env.BSC_USDT_CONFIRMATIONS || process.env.BSC_CONFIRMATIONS || 12),
  tron: Number(process.env.TRON_USDT_CONFIRMATIONS || process.env.TRX_CONFIRMATIONS || 20),
};
const ALLOWLIST = {
  ethereum: String(process.env.USDT_ETH_CONTRACT || '').trim().toLowerCase(),
  bsc: String(process.env.USDT_BSC_CONTRACT || '').trim().toLowerCase(),
  tron: String(process.env.USDT_TRON_CONTRACT || '').trim().toLowerCase(),
};

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeNetworkKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (NETWORK_KEYS.includes(normalized)) return normalized;
  if (normalized === 'erc20' || normalized === 'eth') return 'ethereum';
  if (normalized === 'bep20' || normalized === 'bnb') return 'bsc';
  if (normalized === 'trc20' || normalized === 'trx') return 'tron';
  return '';
}

function normalizeStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return STATUS_KEYS.includes(normalized) ? normalized : '';
}

export function normalizeDepositAddress(networkKey, address) {
  const raw = String(address || '').trim();
  if (!raw) return raw;
  return networkKey === 'tron' ? raw : raw.toLowerCase();
}

export function getWalletNetworkKey(networkKey) {
  return NETWORK_TO_WALLET[normalizeNetworkKey(networkKey)] || null;
}

export function getAllowedTokenContract(networkKey) {
  return ALLOWLIST[normalizeNetworkKey(networkKey)] || '';
}

export function getRequiredConfirmations(networkKey) {
  return DEFAULT_CONFIRMATIONS[normalizeNetworkKey(networkKey)] || 12;
}

function deriveStatus(confirmations, confirmationTarget, credited = false) {
  if (credited) return 'credited';
  const safeConfirmations = Number(confirmations || 0);
  const safeTarget = Number(confirmationTarget || 0);
  if (safeTarget > 0 && safeConfirmations >= safeTarget) return 'confirmed';
  if (safeConfirmations > 1) return 'pending';
  return 'detected';
}

function mapDepositRow(row) {
  return {
    id: row.id,
    network: row.network_key,
    token: row.token_key,
    txHash: row.tx_hash,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    amount: row.amount,
    status: row.status,
    confirmationCount: Number(row.confirmations || 0),
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    creditedAt: row.credited_at,
    rawPayload: parseJson(row.raw_payload),
  };
}

async function hasReferralCreditAlreadyApplied(
  trx,
  { userId, incomeType, referenceId, sourceUserId = null }
) {
  const existing = await trx('mlm_income_history')
    .where({
      user_id: userId,
      income_type: incomeType,
      reference_id: String(referenceId),
      status: 'SUCCESS',
    })
    .modify((query) => {
      if (sourceUserId !== null && sourceUserId !== undefined) {
        query.andWhere({ source_user_id: sourceUserId });
      }
    })
    .first('id');

  return Boolean(existing);
}

async function applyFirstDepositReferralRewards(
  trx,
  { userId, referenceKey, depositAmount, now = new Date(), sponsorId = null }
) {
  const depositor = await trx('users')
    .select('id', 'sponsor_id', 'join_reward_paid', 'first_deposit_amount')
    .where({ id: userId })
    .forUpdate()
    .first();

  if (!depositor || depositor.first_deposit_amount) {
    return { applied: false };
  }

  const effectiveSponsorId = sponsorId ?? (depositor.sponsor_id ? Number(depositor.sponsor_id) : null);
  const sponsor = effectiveSponsorId
    ? await trx('users')
        .select('id')
        .where({ id: effectiveSponsorId })
        .forUpdate()
        .first()
    : null;

  const { config } = await getLevelManagementSettings();
  const sponsorPercent = Number(config?.directSponsorCommissionPercent ?? 0);
  const joinPercent = Number(config?.joinedCommissionPercent ?? 0);
  const firstDepositAmount = Number(depositAmount);

  await trx('users')
    .where({ id: userId })
    .update({
      first_deposit_amount: String(depositAmount),
      first_deposit_at: now,
      updated_at: now,
    });

  const depositReferenceId = `deposit:${referenceKey}`;

  if (
    sponsor &&
    sponsorPercent > 0 &&
    !(await hasReferralCreditAlreadyApplied(trx, {
      userId: effectiveSponsorId,
      incomeType: 'direct_sponsor_commission',
      referenceId: depositReferenceId,
      sourceUserId: userId,
    }))
  ) {
    const sponsorAmount = String((firstDepositAmount * sponsorPercent) / 100);
    await applyWalletCreditRecord(
      {
        userId: effectiveSponsorId,
        amount: sponsorAmount,
        type: 'direct_sponsor_commission',
        sourceType: 'direct_sponsor_commission',
        referenceId: depositReferenceId,
        remark: 'Direct referral income credited from first deposit',
        meta: {
          depositId: referenceKey,
          sourceUserId: userId,
          incomeType: 'direct_referral',
        },
        mlm: {
          incomeType: 'direct_sponsor_commission',
          sourceUserId: userId,
        },
      },
      trx
    );
  }

  if (
    canGiveJoinReward(depositor) &&
    joinPercent > 0 &&
    !(await hasReferralCreditAlreadyApplied(trx, {
      userId,
      incomeType: 'joined_commission',
      referenceId: depositReferenceId,
    }))
  ) {
    const joinAmount = String((firstDepositAmount * joinPercent) / 100);
    await applyWalletCreditRecord(
      {
        userId,
        amount: joinAmount,
        type: 'joined_commission',
        sourceType: 'joined_commission',
        referenceId: depositReferenceId,
        remark: 'Joining reward credited from first deposit',
        meta: {
          depositId: referenceKey,
          incomeType: 'join_reward',
        },
        mlm: {
          incomeType: 'joined_commission',
          sourceUserId: effectiveSponsorId,
        },
      },
      trx
    );
    await trx('users')
      .where({ id: userId })
      .update({
        join_reward_paid: true,
        updated_at: now,
      });
  }

  return { applied: true };
}

export async function upsertDetectedDeposit({
  userId,
  network,
  token = 'usdt',
  contractAddress,
  txHash,
  logIndex = 0,
  amount,
  fromAddress = null,
  toAddress = null,
  blockNumber = null,
  confirmations = 0,
  confirmationTarget,
  rawPayload = null,
  source = 'monitor',
  confirmedAt = null,
}) {
  const normalizedNetwork = normalizeNetworkKey(network);
  if (!normalizedNetwork) return { ignored: true, reason: 'INVALID_NETWORK' };
  if (String(token || '').trim().toLowerCase() !== 'usdt') {
    return { ignored: true, reason: 'INVALID_TOKEN' };
  }

  const expectedContract = getAllowedTokenContract(normalizedNetwork);
  const normalizedContract = String(contractAddress || '').trim().toLowerCase();
  if (!expectedContract || !normalizedContract || normalizedContract !== expectedContract) {
    return { ignored: true, reason: 'INVALID_CONTRACT' };
  }

  const walletNetwork = getWalletNetworkKey(normalizedNetwork);
  const normalizedTo = normalizeDepositAddress(normalizedNetwork, toAddress);
  const wallet = await db('user_wallets')
    .where({
      network: walletNetwork,
      address: normalizedTo,
    })
    .first();
  if (!wallet) return { ignored: true, reason: 'UNKNOWN_ADDRESS' };

  const safeTarget = Number(confirmationTarget ?? getRequiredConfirmations(normalizedNetwork));
  const safeConfirmations = Number(confirmations || 0);
  const nextStatus = deriveStatus(safeConfirmations, safeTarget, false);
  const now = new Date();

  return withTx(async (trx) => {
    const existing = await trx('deposits')
      .where({
        chain: walletNetwork,
        tx_hash: String(txHash || '').trim(),
        log_index: Number(logIndex || 0),
      })
      .forUpdate()
      .first();

    if (!existing) {
      const inserted = await trx('deposits').insert({
        user_id: wallet.user_id,
        chain: walletNetwork,
        network_key: normalizedNetwork,
        asset: 'USDT',
        token_key: 'usdt',
        token_contract: normalizedContract,
        tx_hash: String(txHash || '').trim(),
        amount: String(amount),
        confirmations: safeConfirmations,
        confirmation_target: safeTarget,
        block_number: blockNumber !== undefined && blockNumber !== null ? Number(blockNumber) : null,
        log_index: Number(logIndex || 0),
        from_address: fromAddress ? normalizeDepositAddress(normalizedNetwork, fromAddress) : null,
        to_address: normalizedTo || null,
        status: nextStatus,
        credited: false,
        confirmed_at: nextStatus === 'confirmed' ? (confirmedAt ? new Date(confirmedAt) : now) : null,
        first_seen_at: now,
        last_seen_at: now,
        last_checked_at: now,
        created_at: now,
        updated_at: now,
        raw_payload: rawPayload ? JSON.stringify(rawPayload) : null,
        source,
      });
      const id = Array.isArray(inserted) ? inserted[0] : inserted;
      return { depositId: id, inserted: true, updated: false, status: nextStatus, userId: wallet.user_id };
    }

    const credited = Boolean(existing.credited);
    const mergedConfirmations = Math.max(Number(existing.confirmations || 0), safeConfirmations);
    const mergedTarget = Math.max(Number(existing.confirmation_target || 0), safeTarget);
    const status = deriveStatus(mergedConfirmations, mergedTarget, credited);
    await trx('deposits')
      .where({ id: existing.id })
      .update({
        user_id: existing.user_id || wallet.user_id,
        network_key: normalizedNetwork,
        token_key: 'usdt',
        token_contract: normalizedContract,
        amount: String(amount ?? existing.amount),
        confirmations: mergedConfirmations,
        confirmation_target: mergedTarget,
        block_number: blockNumber !== undefined && blockNumber !== null ? Number(blockNumber) : existing.block_number,
        from_address: fromAddress ? normalizeDepositAddress(normalizedNetwork, fromAddress) : existing.from_address,
        to_address: normalizedTo || existing.to_address,
        status,
        confirmed_at:
          status === 'confirmed' || status === 'credited'
            ? existing.confirmed_at || (confirmedAt ? new Date(confirmedAt) : now)
            : null,
        last_seen_at: now,
        last_checked_at: now,
        updated_at: now,
        raw_payload: rawPayload ? JSON.stringify(rawPayload) : existing.raw_payload,
        source,
      });

    return { depositId: existing.id, inserted: false, updated: true, status, userId: existing.user_id || wallet.user_id };
  });
}

export async function creditConfirmedDeposit(depositId) {
  return withTx(async (trx) => {
    const row = await trx('deposits').where({ id: Number(depositId) }).forUpdate().first();
    if (!row) {
      const err = new Error('DEPOSIT_NOT_FOUND');
      err.status = 404;
      throw err;
    }

    if (row.credited || row.status === 'credited') {
      return { ok: true, noop: true, depositId: row.id, status: 'credited' };
    }

    if (!['confirmed', 'credited'].includes(String(row.status || '').toLowerCase())) {
      const err = new Error('DEPOSIT_NOT_CREDITABLE');
      err.status = 400;
      throw err;
    }

    const now = new Date();
    await journal(
      trx,
      [
        {
          account: { userId: null, namespace: 'hot:wallet', asset: row.asset },
          amount: `-${row.amount}`,
          meta: { reason: 'deposit_credit', depositId: row.id, network: row.network_key },
        },
        {
          account: { userId: row.user_id, namespace: 'spot:available', asset: row.asset },
          amount: String(row.amount),
          meta: { reason: 'deposit_credit', depositId: row.id, network: row.network_key },
        },
      ],
      { description: `Deposit credit ${row.asset}`, meta: { depositId: row.id, userId: row.user_id } }
    );

    if (String(row.asset).toUpperCase() === 'USDT') {
      await applyWalletCreditRecord(
        {
          userId: row.user_id,
          amount: row.amount,
          type: 'deposit_credit',
          sourceType: 'deposit',
          referenceId: row.id,
          remark: 'Successful USDT deposit credited to main wallet',
          meta: { asset: row.asset, depositId: row.id },
        },
        trx
      );
    }

    await trx('deposits')
      .where({ id: row.id })
      .update({
        credited: true,
        status: 'credited',
        credited_at: now,
        updated_at: now,
      });

    await applyFirstDepositReferralRewards(trx, {
      userId: row.user_id,
      referenceKey: row.id,
      depositAmount: row.amount,
      now,
    });

    return { ok: true, noop: false, depositId: row.id, status: 'credited' };
  });
}

export { applyFirstDepositReferralRewards };

export async function maybeCreditDeposit(depositId) {
  const row = await db('deposits').where({ id: Number(depositId) }).first();
  if (!row) return null;
  if (row.credited || row.status === 'credited') return { ok: true, noop: true, depositId: row.id };
  if (String(row.status || '').toLowerCase() !== 'confirmed') return { ok: false, noop: true, depositId: row.id };
  return creditConfirmedDeposit(row.id);
}

export async function listFundingDepositHistory(userId, { network, status, page = 1, limit = 20 } = {}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const normalizedNetwork = normalizeNetworkKey(network);
  const normalizedStatus = normalizeStatus(status);

  const query = db('deposits').where({ user_id: userId, token_key: 'usdt' });
  if (normalizedNetwork) query.andWhere({ network_key: normalizedNetwork });
  if (normalizedStatus) query.andWhere({ status: normalizedStatus });

  const countRow = await query.clone().count({ total: '*' }).first();
  const total = Number(countRow?.total ?? 0);
  const rows = await query
    .clone()
    .orderBy('created_at', 'desc')
    .offset((safePage - 1) * safeLimit)
    .limit(safeLimit);

  return {
    items: rows.map(mapDepositRow),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
    },
  };
}

export async function getFundingDepositSummary(userId) {
  const rows = await db('deposits')
    .where({ user_id: userId, token_key: 'usdt' })
    .select('network_key', 'status')
    .count({ total: '*' })
    .groupBy('network_key', 'status');

  const base = {
    all: { detected: 0, pending: 0, confirmed: 0, credited: 0, total: 0 },
    ethereum: { detected: 0, pending: 0, confirmed: 0, credited: 0, total: 0 },
    bsc: { detected: 0, pending: 0, confirmed: 0, credited: 0, total: 0 },
    tron: { detected: 0, pending: 0, confirmed: 0, credited: 0, total: 0 },
  };

  for (const row of rows) {
    const network = normalizeNetworkKey(row.network_key);
    const status = normalizeStatus(row.status);
    const total = Number(row.total || 0);
    if (!network || !status) continue;
    base[network][status] += total;
    base[network].total += total;
    base.all[status] += total;
    base.all.total += total;
  }

  return base;
}

export async function getFundingDepositAddresses(userId) {
  const wallets = await listUserWallets(userId);
  return wallets
    .map((wallet) => {
      const network = normalizeNetworkKey(wallet.network);
      if (!network) return null;
      return {
        network,
        token: 'usdt',
        address: wallet.address,
        chain: wallet.network,
      };
    })
    .filter(Boolean);
}

export async function getFundingDepositAddressByNetwork(userId, network) {
  const normalized = normalizeNetworkKey(network);
  const walletNetwork = getWalletNetworkKey(normalized);
  if (!walletNetwork) return null;
  const wallet = await getUserWalletByNetwork(userId, walletNetwork);
  if (!wallet) return null;
  return {
    network: normalized,
    token: 'usdt',
    address: wallet.address,
    chain: wallet.network,
  };
}

export async function updateScanCursor(network, { lastProcessedBlock, cursorValue, cursorMeta } = {}) {
  const walletNetwork = getWalletNetworkKey(network) || String(network || '').trim().toUpperCase();
  await db('deposit_scan_state')
    .where({ network: walletNetwork })
    .update({
      last_processed_block:
        lastProcessedBlock !== undefined && lastProcessedBlock !== null
          ? Number(lastProcessedBlock)
          : db.raw('last_processed_block'),
      cursor_value: cursorValue !== undefined ? cursorValue : db.raw('cursor_value'),
      cursor_meta: cursorMeta !== undefined ? JSON.stringify(cursorMeta) : db.raw('cursor_meta'),
      last_synced_at: new Date(),
      updated_at: new Date(),
    });
}
