import { Contract, Wallet, formatUnits, parseUnits } from 'ethers';
import { db, withTx } from '../db.js';
import { checkWalletGasStatus, confirmGasFunding, estimateSweepGas, fundUserGas } from './gasFunding.service.js';
import { getExplorerTransactionsForAddress } from './depositExplorerService.js';
import {
  EVM_ERC20_ABI,
  TRC20_ABI,
  createTronClient,
  getAdminWalletRecord,
  getEvmProvider,
  getSweepNetworkConfig,
  getTokenBalanceRaw,
  getUserWalletSecret,
  logSweepEvent,
  normalizeSweepNetwork,
} from './sweepNetwork.service.js';
import { getTronOwnerAddress, isTronAccountActive } from '../utils/tron.js';

const ACTIVE_SWEEP_STATUSES = [
  'pending',
  'gas_checking',
  'insufficient_gas',
  'gas_funding_pending',
  'gas_funding_sent',
  'gas_funding_confirmed',
  'ready_to_sweep',
  'sweep_pending',
  'sweep_sent',
];
const TRON_GAS_CONFIRMATION_ATTEMPTS = 6;
const TRON_GAS_CONFIRMATION_DELAY_MS = 3000;

function sanitizeSweepDebugPayload(userWallet, config) {
  return {
    userWallet: userWallet
      ? {
          id: userWallet.id,
          user_id: userWallet.user_id,
          network: userWallet.network,
          address: userWallet.address,
          is_active: userWallet.is_active,
          normalizedAddress: userWallet.normalizedAddress,
        }
      : null,
    config: config
      ? {
          network: config.network,
          walletNetwork: config.walletNetwork,
          assetNetwork: config.assetNetwork,
          gasAsset: config.gasAsset,
          decimals: config.decimals,
          isTron: config.isTron,
          tokenContract: config.tokenContract,
          rpcUrl: config.rpcUrl,
          fullHost: config.fullHost,
          minSweepUsdt: config.minSweepUsdt,
          gasTopupMin: config.gasTopupMin,
          gasTopupAmount: config.gasTopupAmount,
        }
      : null,
  };
}

function logSweepStepError(step, context, error) {
  console.error(`[sweep:${step}]`, {
    ...context,
    error: String(error?.message || error || 'UNKNOWN_SWEEP_ERROR'),
    status: error?.status || null,
    code: error?.code || null,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGasFundingConfirmation(fundingId, {
  attempts = TRON_GAS_CONFIRMATION_ATTEMPTS,
  delayMs = TRON_GAS_CONFIRMATION_DELAY_MS,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const confirmation = await confirmGasFunding(fundingId);
    if (confirmation?.confirmed) {
      return confirmation;
    }
    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }
  return { ok: true, confirmed: false, status: 'sent' };
}

function getAmountRawFromDeposit(row, decimals) {
  if (row.usdt_amount_raw) return BigInt(row.usdt_amount_raw);
  return parseUnits(String(row.usdt_amount_decimal || '0'), decimals);
}

function normalizeExplorerNetwork(network) {
  const normalized = normalizeSweepNetwork(network);
  if (normalized === 'ethereum') return 'ERC20';
  if (normalized === 'bsc') return 'BEP20';
  if (normalized === 'tron') return 'TRC20';
  return String(network || '').trim().toUpperCase();
}

function normalizeComparableAddress(network, address) {
  const raw = String(address || '').trim();
  if (!raw) return '';
  return normalizeSweepNetwork(network) === 'tron' ? raw : raw.toLowerCase();
}

async function markSweepConfirmedFromExplorer(row, transfer) {
  const txHash = String(transfer?.txHash || transfer?.transactionHash || '').trim();
  const confirmedAt = transfer?.confirmedAt ? new Date(transfer.confirmedAt) : new Date();
  const amount = String(transfer?.amount || row.usdt_amount_decimal || '0');

  await withTx(async (trx) => {
    await trx('sweep_transactions').where({ id: row.id }).update({
      status: 'sweep_confirmed',
      error_message: null,
      sweep_tx_hash: txHash || row.sweep_tx_hash || null,
      usdt_amount_decimal: amount,
      swept_at: confirmedAt,
      updated_at: new Date(),
    });

    if (row.deposit_transaction_id) {
      await trx('deposit_transactions').where({ id: row.deposit_transaction_id }).update({
        is_swept: true,
        sweep_status: 'sweep_confirmed',
        sweep_tx_hash: txHash || row.sweep_tx_hash || null,
        swept_at: confirmedAt,
        updated_at: new Date(),
      });
    }
  });

  logSweepEvent('info', {
    sweepId: row.id,
    userId: row.user_id,
    network: row.network,
    sourceWallet: row.source_wallet_address,
    destinationWallet: row.destination_admin_wallet_address,
    amount,
    sweepTxHash: txHash || row.sweep_tx_hash || null,
    finalStatus: 'sweep_confirmed',
    source: 'explorer_reconcile',
  }, 'sweep_reconciled_from_explorer');

  return {
    ok: true,
    reconciled: true,
    status: 'sweep_confirmed',
    txHash: txHash || row.sweep_tx_hash || null,
  };
}

async function reconcileSweepFromExplorer(row) {
  const explorerNetwork = normalizeExplorerNetwork(row.network);
  const sourceAddress = normalizeComparableAddress(row.network, row.source_wallet_address);
  const destinationAddress = normalizeComparableAddress(row.network, row.destination_admin_wallet_address);
  const minimumAmount = Number(row.usdt_amount_decimal || 0);
  if (!sourceAddress || !destinationAddress) return null;

  const transfers = await getExplorerTransactionsForAddress(row.source_wallet_address, explorerNetwork);
  const match = transfers.find((transfer) => {
    if (!transfer?.confirmed) return false;
    const fromAddress = normalizeComparableAddress(row.network, transfer.fromAddress);
    const toAddress = normalizeComparableAddress(row.network, transfer.toAddress);
    const amount = Number(transfer.amount || 0);
    return fromAddress === sourceAddress
      && toAddress === destinationAddress
      && Number.isFinite(amount)
      && amount >= minimumAmount;
  });

  if (!match) return null;
  return markSweepConfirmedFromExplorer(row, match);
}

async function markDepositSwept(trx, depositId, sweepId, txHash) {
  await trx('deposit_transactions').where({ id: depositId }).update({
    is_swept: true,
    swept_at: new Date(),
    sweep_tx_hash: txHash,
    sweep_status: 'sweep_confirmed',
    sweep_transaction_id: sweepId,
    updated_at: new Date(),
  });
}

async function markDepositSweepPending(trx, depositId, sweepId, status) {
  await trx('deposit_transactions').where({ id: depositId }).update({
    sweep_status: status,
    sweep_transaction_id: sweepId,
    updated_at: new Date(),
  });
}

async function executeEvmSweep(network, userWallet, destination, amountRaw) {
  const config = await getSweepNetworkConfig(network);
  const provider = await getEvmProvider(network);
  const signer = new Wallet(userWallet.decryptedPrivateKey, provider);
  const contract = new Contract(config.tokenContract, EVM_ERC20_ABI, signer);
  console.log('[evm-sweep:before-send]', {
    network,
    sourceWallet: userWallet.address,
    destinationWallet: destination,
    tokenContract: config.tokenContract,
    rpcUrl: config.rpcUrl,
    amountRaw: amountRaw.toString(),
  });
  const tx = await contract.transfer(destination, amountRaw);
  const receipt = await tx.wait();
  console.log('[evm-sweep:sent]', {
    network,
    sourceWallet: userWallet.address,
    destinationWallet: destination,
    tokenContract: config.tokenContract,
    rpcUrl: config.rpcUrl,
    amountRaw: amountRaw.toString(),
    txHash: receipt?.hash || tx.hash,
  });
  return {
    txHash: receipt?.hash || tx.hash,
    actualGasFeeRaw: receipt?.gasUsed && receipt?.gasPrice ? receipt.gasUsed * receipt.gasPrice : null,
  };
}

async function executeTronSweep(network, userWallet, destination, amountRaw) {
  const config = await getSweepNetworkConfig(network);
  const accountActive = await isTronAccountActive(userWallet.address, config.fullHost || config.rpcUrl);
  if (!accountActive) {
    const err = new Error('TRON_SOURCE_ACCOUNT_NOT_ACTIVATED');
    err.status = 400;
    throw err;
  }
  const tronWeb = createTronClient(userWallet.decryptedPrivateKey, config.rpcUrl);
  const ownerAddress = getTronOwnerAddress(tronWeb, userWallet.decryptedPrivateKey);

  if (String(userWallet.address || '').trim() && ownerAddress !== String(userWallet.address).trim()) {
    const err = new Error('TRON_SWEEP_OWNER_ADDRESS_MISMATCH');
    err.status = 400;
    throw err;
  }

  try {
    const contract = await tronWeb.contract().at(config.tokenContract);
    console.log('[tron-sweep:before-send]', {
      network,
      sourceWallet: userWallet.address,
      derivedOwnerAddress: ownerAddress,
      destinationWallet: destination,
      tokenContract: config.tokenContract,
      rpcUrl: config.rpcUrl,
      amountRaw: amountRaw.toString(),
    });
    const txHash = await contract.transfer(destination, amountRaw.toString()).send(
      {
        from: ownerAddress,
        feeLimit: 100_000_000,
      },
      userWallet.decryptedPrivateKey
    );
    console.log('[tron-sweep:sent]', {
      network,
      sourceWallet: userWallet.address,
      derivedOwnerAddress: ownerAddress,
      destinationWallet: destination,
      tokenContract: config.tokenContract,
      rpcUrl: config.rpcUrl,
      amountRaw: amountRaw.toString(),
      txHash,
    });
    return {
      txHash,
      actualGasFeeRaw: null,
    };
  } catch (error) {
    const rawMessage = String(error?.message || error || 'TRON_SWEEP_FAILED');
    console.error('[tron-sweep]', {
      network,
      sourceWallet: userWallet.address,
      derivedOwnerAddress: ownerAddress,
      destinationWallet: destination,
      tokenContract: config.tokenContract,
      rpcUrl: config.rpcUrl,
      error: rawMessage,
    });

    if (/owner_address isn't set/i.test(rawMessage)) {
      const err = new Error('TRON_SWEEP_OWNER_ADDRESS_NOT_SET');
      err.status = 400;
      throw err;
    }

    if (/does not exist/i.test(rawMessage)) {
      const err = new Error('TRON_SOURCE_ACCOUNT_NOT_ACTIVATED');
      err.status = 400;
      throw err;
    }

    throw error;
  }
}

export async function queueEligibleSweeps({ network, triggerType = 'auto' } = {}) {
  const normalized = normalizeSweepNetwork(network);
  const rows = await db('deposit_transactions')
    .where({ token: 'USDT', credited: 1, is_swept: 0 })
    .modify((builder) => {
      if (normalized) builder.andWhere({ network: normalized });
    })
    .orderBy('created_at', 'asc');

  const queued = [];
  for (const deposit of rows) {
    const existing = await db('sweep_transactions')
      .where({ deposit_transaction_id: deposit.id })
      .whereIn('status', ACTIVE_SWEEP_STATUSES)
      .first();
    if (existing) {
      queued.push(existing);
      continue;
    }

    const adminWallet = await getAdminWalletRecord(deposit.network);
    const config = await getSweepNetworkConfig(deposit.network);
    const amountRaw = parseUnits(String(deposit.amount_decimal || '0'), config.decimals);
    try {
      const inserted = await db('sweep_transactions').insert({
        user_id: deposit.user_id,
        network: deposit.network,
        token: 'USDT',
        source_wallet_address: deposit.deposit_address || deposit.to_address || '',
        destination_admin_wallet_address: adminWallet.address,
        deposit_transaction_id: deposit.id,
        usdt_amount_raw: amountRaw.toString(),
        usdt_amount_decimal: String(deposit.amount_decimal || '0'),
        gas_asset: config.gasAsset,
        gas_status: 'unknown',
        status: 'pending',
        trigger_type: triggerType,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const id = Array.isArray(inserted) ? inserted[0] : inserted;
      await db('deposit_transactions').where({ id: deposit.id }).update({
        sweep_transaction_id: id,
        sweep_status: 'pending',
        updated_at: new Date(),
      });
      queued.push(await db('sweep_transactions').where({ id }).first());
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY' || /sweep_transactions_deposit_unique/i.test(String(err?.message || ''))) {
        const existingSweep = await db('sweep_transactions')
          .where({ deposit_transaction_id: deposit.id })
          .first();
        if (existingSweep) {
          await db('deposit_transactions').where({ id: deposit.id }).update({
            sweep_transaction_id: existingSweep.id,
            sweep_status: existingSweep.status || 'pending',
            updated_at: new Date(),
          });
          queued.push(existingSweep);
          continue;
        }
      }
      throw err;
    }
  }

  return queued;
}

async function getSweepRowOrThrow(sweepId) {
  const row = await db('sweep_transactions').where({ id: Number(sweepId) }).first();
  if (!row) {
    const err = new Error('SWEEP_NOT_FOUND');
    err.status = 404;
    throw err;
  }
  return row;
}

export async function processSweep(sweepId, options = {}) {
  const {
    autoContinueAfterFunding = true,
  } = options || {};
  const row = await getSweepRowOrThrow(sweepId);
  const config = await getSweepNetworkConfig(row.network);
  const userWallet = await getUserWalletSecret(row.user_id, row.network);
  const depositAmountRaw = getAmountRawFromDeposit(row, config.decimals);
  const debugContext = {
    sweepId: row.id,
    userId: row.user_id,
    network: row.network,
    depositTransactionId: row.deposit_transaction_id || null,
    sourceWallet: row.source_wallet_address || userWallet.address,
    destinationWallet: row.destination_admin_wallet_address,
    amountRaw: depositAmountRaw.toString(),
    amountDecimal: row.usdt_amount_decimal,
  };

  await withTx(async (trx) => {
    await trx('sweep_transactions').where({ id: row.id }).update({
      status: 'gas_checking',
      updated_at: new Date(),
    });
    if (row.deposit_transaction_id) {
      await markDepositSweepPending(trx, row.deposit_transaction_id, row.id, 'gas_checking');
    }
  });

  const minSweepRaw = parseUnits(String(config.minSweepUsdt || '0'), config.decimals);
  
  console.log('2.Getting sweep readiness for', { userWallet:userWallet, config, row, depositAmountRaw, userWalletDebug:sanitizeSweepDebugPayload(userWallet, config)});

  let onchainBalanceRaw;
  try {
    onchainBalanceRaw = await getTokenBalanceRaw(userWallet.address, row.network, userWallet.decryptedPrivateKey);
  } catch (error) {
    logSweepStepError('token-balance', {
      ...debugContext,
      userWalletAddress: userWallet.address,
      tokenContract: config.tokenContract,
      rpcUrl: config.rpcUrl,
      fullHost: config.fullHost,
    }, error);
    throw error;
  }
  console.log('[sweep:onchain-balance]', {
    sweepId: row.id,
    network: row.network,
    sourceWallet: userWallet.address,
    depositAmountRaw: depositAmountRaw.toString(),
    onchainBalanceRaw: onchainBalanceRaw.toString(),
    onchainBalanceDecimal: formatUnits(onchainBalanceRaw, config.decimals),
    config:config
  });
  if (onchainBalanceRaw < minSweepRaw || onchainBalanceRaw <= 0n) {
    const message = onchainBalanceRaw < minSweepRaw ? 'BELOW_MIN_SWEEP_THRESHOLD' : 'INSUFFICIENT_USDT_BALANCE';
    await withTx(async (trx) => {
      await trx('sweep_transactions').where({ id: row.id }).update({
        status: 'failed',
        gas_status: 'unknown',
        error_message: message,
        updated_at: new Date(),
      });
      if (row.deposit_transaction_id) {
        await markDepositSweepPending(trx, row.deposit_transaction_id, row.id, 'failed');
      }
    });
    return { ok: false, status: 'failed', error: message };
  }
  const sweepAmountRaw = onchainBalanceRaw;
  const sweepAmountDecimal = formatUnits(sweepAmountRaw, config.decimals);

  let estimated;
  try {
    estimated = await estimateSweepGas(userWallet.id, row.network, sweepAmountDecimal);
  } catch (error) {
    logSweepStepError('estimate-gas', {
      ...debugContext,
      userWalletId: userWallet.id,
      gasAsset: config.gasAsset,
      sweepAmountRaw: sweepAmountRaw.toString(),
      sweepAmountDecimal,
    }, error);
    throw error;
  }

  let gasStatus;
  try {
    gasStatus = await checkWalletGasStatus(userWallet.id, row.network);
  } catch (error) {
    logSweepStepError('check-gas-status', {
      ...debugContext,
      userWalletId: userWallet.id,
      gasAsset: config.gasAsset,
    }, error);
    throw error;
  }
  await withTx(async (trx) => {
    await trx('sweep_transactions').where({ id: row.id }).update({
      estimated_gas_fee_raw: estimated.estimatedFeeRaw?.toString?.() || String(estimated.estimatedFeeRaw || ''),
      estimated_gas_fee_decimal: estimated.estimatedFeeDecimal || null,
      gas_status: gasStatus.status === 'sufficient' ? 'sufficient' : 'insufficient',
      status: gasStatus.status === 'sufficient' ? 'ready_to_sweep' : 'insufficient_gas',
      usdt_amount_raw: sweepAmountRaw.toString(),
      usdt_amount_decimal: sweepAmountDecimal,
      updated_at: new Date(),
    });
    if (row.deposit_transaction_id) {
      await markDepositSweepPending(
        trx,
        row.deposit_transaction_id,
        row.id,
        gasStatus.status === 'sufficient' ? 'ready_to_sweep' : 'insufficient_gas'
      );
    }
  });

  if (gasStatus.status !== 'sufficient') {
    let funding;
    try {
      funding = await fundUserGas(userWallet.id, row.network, { sweepId: row.id });
    } catch (error) {
      logSweepStepError('fund-user-gas', {
        ...debugContext,
        userWalletId: userWallet.id,
        gasAsset: config.gasAsset,
      }, error);
      throw error;
    }
    if (config.isTron && autoContinueAfterFunding && funding?.fundingId && ['sent', 'broadcasted', 'confirmed'].includes(String(funding.status || '').toLowerCase())) {
      const confirmation = await waitForGasFundingConfirmation(funding.fundingId);
      if (confirmation?.confirmed) {
        return processSweep(row.id, { autoContinueAfterFunding: false });
      }
    }
    return { ok: true, status: funding.status === 'sent' ? 'gas_funding_sent' : funding.status, fundingId: funding.fundingId };
  }

  await withTx(async (trx) => {
    await trx('sweep_transactions').where({ id: row.id }).update({
      status: 'sweep_pending',
      updated_at: new Date(),
    });
    if (row.deposit_transaction_id) {
      await markDepositSweepPending(trx, row.deposit_transaction_id, row.id, 'sweep_pending');
    }
  });

  let result;
  try {
    result = config.isTron
      ? await executeTronSweep(row.network, userWallet, row.destination_admin_wallet_address, sweepAmountRaw)
      : await executeEvmSweep(row.network, userWallet, row.destination_admin_wallet_address, sweepAmountRaw);
  } catch (error) {
    logSweepStepError('execute-sweep', {
      ...debugContext,
      isTron: config.isTron,
      tokenContract: config.tokenContract,
      rpcUrl: config.rpcUrl,
      fullHost: config.fullHost,
      sweepAmountRaw: sweepAmountRaw.toString(),
      sweepAmountDecimal,
    }, error);
    throw error;
  }

  await withTx(async (trx) => {
    await trx('sweep_transactions').where({ id: row.id }).update({
      status: 'sweep_confirmed',
      gas_status: 'consumed',
      usdt_amount_raw: sweepAmountRaw.toString(),
      usdt_amount_decimal: sweepAmountDecimal,
      sweep_tx_hash: result.txHash,
      swept_at: new Date(),
      updated_at: new Date(),
    });
    if (row.deposit_transaction_id) {
      await markDepositSwept(trx, row.deposit_transaction_id, row.id, result.txHash);
    }
  });

  logSweepEvent('info', {
    userId: row.user_id,
    network: row.network,
    sourceWallet: row.source_wallet_address,
    destinationWallet: row.destination_admin_wallet_address,
    amount: sweepAmountDecimal,
    gasThreshold: config.gasTopupMin,
    estimatedGasFee: estimated.estimatedFeeDecimal,
    actualGasFee: result.actualGasFeeRaw ? formatUnits(result.actualGasFeeRaw, row.network === 'tron' ? 6 : 18) : null,
    gasTopupTxHash: row.gas_topup_tx_hash,
    sweepTxHash: result.txHash,
    finalStatus: 'sweep_confirmed',
  }, 'sweep_confirmed');

  return { ok: true, status: 'sweep_confirmed', txHash: result.txHash };
}

export async function retryFailedSweep(sweepId) {
  const row = await getSweepRowOrThrow(sweepId);
  if (String(row.status || '').toLowerCase().includes('failed')) {
    const reconciled = await reconcileSweepFromExplorer(row);
    if (reconciled) {
      return reconciled;
    }
  }
  await db('sweep_transactions').where({ id: row.id }).update({
    status: 'pending',
    gas_status: 'unknown',
    error_message: null,
    updated_at: new Date(),
  });
  if (row.deposit_transaction_id) {
    await db('deposit_transactions').where({ id: row.deposit_transaction_id }).update({
      sweep_status: 'pending',
      updated_at: new Date(),
    });
  }
  return processSweep(row.id);
}

export async function processPendingSweepsByNetwork(network) {
  await queueEligibleSweeps({ network, triggerType: 'batch' });
  const normalized = normalizeSweepNetwork(network);
  const rows = await db('sweep_transactions')
    .modify((builder) => {
      if (normalized) builder.where({ network: normalized });
    })
    .whereIn('status', ['pending', 'insufficient_gas', 'gas_funding_confirmed', 'ready_to_sweep', 'failed'])
    .orderBy('created_at', 'asc');

  const results = [];
  for (const row of rows) {
    if (row.status === 'insufficient_gas' && row.gas_topup_tx_hash) {
      const funding = await db('gas_funding_transactions')
        .where({ sweep_transaction_id: row.id })
        .orderBy('created_at', 'desc')
        .first();
      if (funding?.id) {
        const confirmation = await confirmGasFunding(funding.id);
        if (!confirmation.confirmed) {
          results.push({ sweepId: row.id, status: 'waiting_for_gas_confirmation' });
          continue;
        }
      }
    }

    try {
      results.push({ sweepId: row.id, ...(await processSweep(row.id)) });
    } catch (err) {
      await db('sweep_transactions').where({ id: row.id }).update({
        status: 'failed',
        error_message: err.message || 'SWEEP_FAILED',
        updated_at: new Date(),
      });
      if (row.deposit_transaction_id) {
        await db('deposit_transactions').where({ id: row.deposit_transaction_id }).update({
          sweep_status: 'failed',
          updated_at: new Date(),
        });
      }
      logSweepEvent('error', {
        userId: row.user_id,
        network: row.network,
        sourceWallet: row.source_wallet_address,
        destinationWallet: row.destination_admin_wallet_address,
        amount: row.usdt_amount_decimal,
        gasTopupTxHash: row.gas_topup_tx_hash,
        sweepTxHash: row.sweep_tx_hash,
        finalStatus: 'failed',
        errorReason: err.message || 'SWEEP_FAILED',
      }, 'sweep_failed');
      results.push({ sweepId: row.id, ok: false, status: 'failed', error: err.message || 'SWEEP_FAILED' });
    }
  }
  return results;
}

export async function listSweepTransactions({ page = 1, limit = 20, network, status, userId } = {}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const normalized = normalizeSweepNetwork(network);
  const query = db('sweep_transactions as s')
    .leftJoin('gas_funding_transactions as g', 'g.sweep_transaction_id', 's.id')
    .select(
      's.*',
      db.raw('MAX(g.id) as latest_gas_funding_id'),
      db.raw('MAX(g.tx_hash) as latest_gas_topup_tx_hash')
    )
    .groupBy('s.id')
    .modify((builder) => {
      if (normalized) builder.where('s.network', normalized);
      if (status) builder.where('s.status', String(status).trim());
      if (userId) builder.where('s.user_id', Number(userId));
    });

  const [countRow, rows] = await Promise.all([
    db('sweep_transactions as s')
      .count({ total: '*' })
      .modify((builder) => {
        if (normalized) builder.where('s.network', normalized);
        if (status) builder.where('s.status', String(status).trim());
        if (userId) builder.where('s.user_id', Number(userId));
      })
      .first(),
    query.clone().orderBy('s.created_at', 'desc').offset((safePage - 1) * safeLimit).limit(safeLimit),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      network: row.network,
      token: row.token,
      sourceWalletAddress: row.source_wallet_address,
      destinationAdminWalletAddress: row.destination_admin_wallet_address,
      depositTransactionId: row.deposit_transaction_id,
      usdtAmountDecimal: row.usdt_amount_decimal,
      estimatedGasFeeDecimal: row.estimated_gas_fee_decimal,
      gasAsset: row.gas_asset,
      gasStatus: row.gas_status,
      gasTopupTxHash: row.gas_topup_tx_hash || row.latest_gas_topup_tx_hash || null,
      sweepTxHash: row.sweep_tx_hash,
      status: row.status,
      triggerType: row.trigger_type,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sweptAt: row.swept_at,
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: Number(countRow?.total || 0),
      totalPages: Number(countRow?.total || 0) ? Math.ceil(Number(countRow.total) / safeLimit) : 0,
    },
  };
}

export async function listGasFundingTransactions({ page = 1, limit = 20, network, status, userId } = {}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const normalized = normalizeSweepNetwork(network);
  const baseQuery = db('gas_funding_transactions')
    .modify((builder) => {
      if (normalized) builder.where({ network: normalized });
      if (status) builder.where({ status: String(status).trim() });
      if (userId) builder.where({ user_id: Number(userId) });
    });

  const [countRow, rows] = await Promise.all([
    baseQuery.clone().count({ total: '*' }).first(),
    baseQuery.clone().orderBy('created_at', 'desc').offset((safePage - 1) * safeLimit).limit(safeLimit),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      network: row.network,
      sourceAdminWalletAddress: row.source_admin_wallet_address,
      destinationUserWalletAddress: row.destination_user_wallet_address,
      gasAsset: row.gas_asset,
      amountDecimal: row.amount_decimal,
      txHash: row.tx_hash,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      sweepTransactionId: row.sweep_transaction_id,
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: Number(countRow?.total || 0),
      totalPages: Number(countRow?.total || 0) ? Math.ceil(Number(countRow.total) / safeLimit) : 0,
    },
  };
}

export async function getCustodialTreasuryOverview() {
  const [wallets, pendingGasTopups, pendingSweeps, balances] = await Promise.all([
    Promise.all(['ethereum', 'bsc', 'tron'].map(async (network) => {
      const adminWallet = await getAdminWalletRecord(network);
      const config = await getSweepNetworkConfig(network);
      console.log('3.Getting treasury overview for', { adminWallet, config });
      const balanceRaw = await getTokenBalanceRaw(adminWallet.address, network, adminWallet.decryptedPrivateKey).catch(() => 0n);
      return {
        network,
        address: adminWallet.address,
        token: adminWallet.token,
        usdtBalance: formatUnits(balanceRaw, config.decimals),
      };
    })),
    db('gas_funding_transactions').whereIn('status', ['pending', 'sent']).count({ total: '*' }).first(),
    db('sweep_transactions').whereIn('status', ACTIVE_SWEEP_STATUSES).count({ total: '*' }).first(),
    db('deposit_transactions')
      .where({ token: 'USDT', is_swept: 1 })
      .select('network')
      .sum({ total: 'amount_decimal' })
      .groupBy('network'),
  ]);

  const totals = { ethereum: '0', bsc: '0', tron: '0' };
  for (const row of balances) {
    if (row.network in totals) totals[row.network] = String(row.total || '0');
  }

  return {
    wallets,
    pendingGasTopups: Number(pendingGasTopups?.total || 0),
    pendingSweeps: Number(pendingSweeps?.total || 0),
    totalTreasuryBalance: totals,
  };
}
