import { Contract, Wallet, formatUnits, parseUnits } from 'ethers';
import { db, withTx } from '../db.js';
import {
  EVM_ERC20_ABI,
  TRC20_ABI,
  createTronClient,
  getAdminWalletSecret,
  getEvmProvider,
  getNativeBalanceRaw,
  getSweepNetworkConfig,
  getTokenBalanceRaw,
  getUserWalletSecret,
  logSweepEvent,
  normalizeSweepNetwork,
} from './sweepNetwork.service.js';
import { getTronOwnerAddress, isTronAccountActive } from '../utils/tron.js';

const GAS_PENDING_STATUSES = ['pending', 'gas_checking', 'insufficient_gas', 'gas_funding_pending', 'gas_funding_sent'];
const FUNDING_ACTIVE_STATUSES = ['pending', 'sent', 'broadcasted', 'confirmed'];
const DEFAULT_TRON_GAS_TOPUP_MIN = '10';
const DEFAULT_TRON_GAS_TOPUP_AMOUNT = '15';

function sanitizeSweepReadinessDebug(userWallet, config) {
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

function toRawGasAmount(amountDecimal, network) {
  if (network === 'tron') return BigInt(Math.round(Number(amountDecimal || 0) * 1_000_000));
  return parseUnits(String(amountDecimal || '0'), 18);
}

function getEffectiveGasTopupMin(config, network) {
  if (network === 'tron' && Number(config?.gasTopupMin || 0) <= 0) return DEFAULT_TRON_GAS_TOPUP_MIN;
  return String(config?.gasTopupMin || '0');
}

function getEffectiveGasTopupAmount(config, network) {
  if (network === 'tron' && Number(config?.gasTopupAmount || 0) <= 0) {
    return Number(config?.gasTopupMin || 0) > 0 ? String(config.gasTopupMin) : DEFAULT_TRON_GAS_TOPUP_AMOUNT;
  }
  return String(config?.gasTopupAmount || config?.gasTopupMin || '0');
}

async function estimateEvmSweepGas(network, userWallet, destination, usdtAmountRaw) {
  const config = await getSweepNetworkConfig(network);
  const provider = await getEvmProvider(network);
  const signer = new Wallet(userWallet.decryptedPrivateKey, provider);
  const contract = new Contract(config.tokenContract, EVM_ERC20_ABI, signer);
  const gasEstimate = await contract.transfer.estimateGas(destination, usdtAmountRaw);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
  const estimatedFeeRaw = gasEstimate * gasPrice;
  return {
    gasEstimateRaw: gasEstimate,
    estimatedFeeRaw,
    estimatedFeeDecimal: formatUnits(estimatedFeeRaw, 18),
  };
}

async function estimateTronSweepGas(network) {
  const config = await getSweepNetworkConfig(network);
  const estimatedFeeRaw = toRawGasAmount(getEffectiveGasTopupMin(config, network), network);
  return {
    gasEstimateRaw: estimatedFeeRaw,
    estimatedFeeRaw,
    estimatedFeeDecimal: formatUnits(estimatedFeeRaw, 6),
  };
}

export async function estimateSweepGas(userWalletId, network, usdtAmount) {
  const normalized = normalizeSweepNetwork(network);
  const config = await getSweepNetworkConfig(normalized);
  const userWallet = await db('user_wallets').where({ id: Number(userWalletId) }).first();
  if (!userWallet) {
    const err = new Error('USER_WALLET_NOT_FOUND');
    err.status = 404;
    throw err;
  }
  const adminWallet = await getAdminWalletSecret(normalized);
  const userWalletSecret = await getUserWalletSecret(userWallet.user_id, normalized);
  const amountRaw = parseUnits(String(usdtAmount || '0'), config.decimals);

  return config.isTron
    ? estimateTronSweepGas(normalized)
    : estimateEvmSweepGas(normalized, userWalletSecret, adminWallet.address, amountRaw);
}

export async function checkWalletGasStatus(userWalletId, network) {
  const normalized = normalizeSweepNetwork(network);
  const config = await getSweepNetworkConfig(normalized);
  const row = await db('user_wallets').where({ id: Number(userWalletId) }).first();
  if (!row) {
    const err = new Error('USER_WALLET_NOT_FOUND');
    err.status = 404;
    throw err;
  }

  const nativeBalanceRaw = await getNativeBalanceRaw(row.address, normalized);
  const nativeBalanceDecimal = formatUnits(nativeBalanceRaw, normalized === 'tron' ? 6 : 18);
  const thresholdDecimal = getEffectiveGasTopupMin(config, normalized);
  const minimumRaw = toRawGasAmount(thresholdDecimal, normalized);
  const accountActive = normalized === 'tron'
    ? await isTronAccountActive(row.address, config.fullHost || config.rpcUrl)
    : true;
  const status = accountActive && nativeBalanceRaw >= minimumRaw ? 'sufficient' : 'insufficient';

  return {
    status,
    gasAsset: config.gasAsset,
    nativeBalanceRaw: nativeBalanceRaw.toString(),
    nativeBalanceDecimal,
    accountActive,
    thresholdRaw: minimumRaw.toString(),
    thresholdDecimal,
  };
}

async function confirmEvmFunding(network, txHash) {
  const provider = await getEvmProvider(network);
  const receipt = await provider.waitForTransaction(txHash, 1);
  return { confirmed: Boolean(receipt?.status === 1), receipt };
}

async function confirmTronFunding(network, txHash) {
  const config = await getSweepNetworkConfig(network);
  const tronWeb = createTronClient('', config.rpcUrl);
  const receipt = await tronWeb.trx.getTransactionInfo(txHash);
  return { confirmed: Boolean(receipt && !receipt.receipt?.result ? true : receipt?.receipt?.result === 'SUCCESS'), receipt };
}

export async function confirmGasFunding(fundingId) {
  const row = await db('gas_funding_transactions').where({ id: Number(fundingId) }).first();
  if (!row) {
    const err = new Error('GAS_FUNDING_NOT_FOUND');
    err.status = 404;
    throw err;
  }
  if (!row.tx_hash) return { ok: false, status: row.status, confirmed: false };

  const normalized = normalizeSweepNetwork(row.network);
  const result = normalized === 'tron'
    ? await confirmTronFunding(normalized, row.tx_hash)
    : await confirmEvmFunding(normalized, row.tx_hash);

  if (result.confirmed) {
    await withTx(async (trx) => {
      await trx('gas_funding_transactions').where({ id: row.id }).update({
        status: 'confirmed',
        completed_at: new Date(),
        updated_at: new Date(),
      });
      if (row.sweep_transaction_id) {
        await trx('sweep_transactions').where({ id: row.sweep_transaction_id }).update({
          status: 'gas_funding_confirmed',
          gas_status: 'topup_confirmed',
          updated_at: new Date(),
        });
      }
    });
  }

  return {
    ok: true,
    confirmed: result.confirmed,
    status: result.confirmed ? 'confirmed' : row.status,
    receipt: result.receipt || null,
  };
}

export async function fundUserGas(userWalletId, network, { sweepId = null, force = false } = {}) {
  const normalized = normalizeSweepNetwork(network);
  const config = await getSweepNetworkConfig(normalized);
  const walletRow = await db('user_wallets').where({ id: Number(userWalletId) }).first();
  if (!walletRow) {
    const err = new Error('USER_WALLET_NOT_FOUND');
    err.status = 404;
    throw err;
  }

  const gasStatus = await checkWalletGasStatus(userWalletId, normalized);
  if (gasStatus.status === 'sufficient' && !force) {
    return {
      ok: true,
      noop: true,
      status: 'sufficient',
      gasAsset: config.gasAsset,
      nativeBalanceDecimal: gasStatus.nativeBalanceDecimal,
    };
  }

  const existing = await db('gas_funding_transactions')
    .where({
      user_id: walletRow.user_id,
      network: normalized,
      destination_user_wallet_address: walletRow.address,
    })
    .whereIn('status', FUNDING_ACTIVE_STATUSES)
    .orderBy('created_at', 'desc')
    .first();
  if (existing && !force) {
    return { ok: true, noop: true, fundingId: existing.id, status: existing.status };
  }

  const adminWallet = await getAdminWalletSecret(normalized);
  const amountRaw = toRawGasAmount(getEffectiveGasTopupAmount(config, normalized), normalized);
  const amountDecimal = normalized === 'tron' ? formatUnits(amountRaw, 6) : formatUnits(amountRaw, 18);

  const fundingId = await withTx(async (trx) => {
    const inserted = await trx('gas_funding_transactions').insert({
      user_id: walletRow.user_id,
      sweep_transaction_id: sweepId,
      network: normalized,
      source_admin_wallet_address: adminWallet.address,
      destination_user_wallet_address: walletRow.address,
      gas_asset: config.gasAsset,
      amount_raw: amountRaw.toString(),
      amount_decimal: amountDecimal,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    });
    const id = Array.isArray(inserted) ? inserted[0] : inserted;
    if (sweepId) {
      await trx('sweep_transactions').where({ id: sweepId }).update({
        gas_status: 'topup_required',
        status: 'gas_funding_pending',
        updated_at: new Date(),
      });
    }
    return id;
  });

  let txHash = null;
  try {
    if (normalized === 'tron') {
      const tronWeb = createTronClient(adminWallet.decryptedPrivateKey, config.rpcUrl);
      const ownerAddress = getTronOwnerAddress(tronWeb, adminWallet.decryptedPrivateKey);
      console.error('[tron-gas-funding:before-send]', {
        fundingId,
        network: normalized,
        rpcUrl: config.rpcUrl,
        sourceAdminWallet: adminWallet.address,
        derivedOwnerAddress: ownerAddress,
        destinationUserWallet: walletRow.address,
        amountRaw: amountRaw.toString(),
        amountDecimal,
        sweepId,
      });
      const unsignedTx = await tronWeb.transactionBuilder.sendTrx(
        walletRow.address,
        Number(amountRaw),
        ownerAddress
      );
      const signedTx = await tronWeb.trx.sign(unsignedTx, adminWallet.decryptedPrivateKey);
      const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);
      txHash = broadcast?.txid || broadcast?.transaction?.txID || signedTx?.txID || null;
    } else {
      const provider = await getEvmProvider(normalized);
      const signer = new Wallet(adminWallet.decryptedPrivateKey, provider);
      const tx = await signer.sendTransaction({
        to: walletRow.address,
        value: amountRaw,
      });
      txHash = tx.hash;
    }

    await withTx(async (trx) => {
      await trx('gas_funding_transactions').where({ id: fundingId }).update({
        tx_hash: txHash,
        status: 'sent',
        updated_at: new Date(),
      });
      if (sweepId) {
        await trx('sweep_transactions').where({ id: sweepId }).update({
          gas_status: 'topup_sent',
          gas_topup_tx_hash: txHash,
          status: 'gas_funding_sent',
          updated_at: new Date(),
        });
      }
    });

    logSweepEvent('info', {
      userId: walletRow.user_id,
      network: normalized,
      sourceWallet: adminWallet.address,
      destinationWallet: walletRow.address,
      gasAsset: config.gasAsset,
      amount: amountDecimal,
      gasTopupTxHash: txHash,
    }, 'gas_funding_sent');

    return { ok: true, fundingId, txHash, status: 'sent' };
  } catch (err) {
    const rawMessage = String(err?.message || err || 'GAS_TOPUP_FAILED');
    if (normalized === 'tron') {
      console.error('[tron-gas-funding:error]', {
        fundingId,
        network: normalized,
        rpcUrl: config.rpcUrl,
        sourceAdminWallet: adminWallet.address,
        destinationUserWallet: walletRow.address,
        amountRaw: amountRaw.toString(),
        amountDecimal,
        sweepId,
        error: rawMessage,
      });
    }

    const normalizedMessage = /owner_address isn't set/i.test(rawMessage)
      ? 'TRON_GAS_FUNDING_OWNER_ADDRESS_NOT_SET'
      : rawMessage;

    await withTx(async (trx) => {
      await trx('gas_funding_transactions').where({ id: fundingId }).update({
        status: 'failed',
        error_message: normalizedMessage || 'GAS_TOPUP_FAILED',
        updated_at: new Date(),
      });
      if (sweepId) {
        await trx('sweep_transactions').where({ id: sweepId }).update({
          gas_status: 'insufficient',
          status: 'failed',
          error_message: normalizedMessage || 'GAS_TOPUP_FAILED',
          updated_at: new Date(),
        });
      }
    });
    if (normalizedMessage !== rawMessage) {
      const mapped = new Error(normalizedMessage);
      mapped.status = 400;
      mapped.cause = err;
      throw mapped;
    }
    throw err;
  }
}

export async function getUserWalletSweepReadiness(userId, network) {
  const config = await getSweepNetworkConfig(network);
  const userWallet = await getUserWalletSecret(userId, network);
  console.log('1.Getting sweep readiness for', sanitizeSweepReadinessDebug(userWallet, config));
  const tokenBalanceRaw = await getTokenBalanceRaw(userWallet.address, config.network, userWallet.decryptedPrivateKey);
  const gasStatus = await checkWalletGasStatus(userWallet.id, config.network);
  return {
    wallet: userWallet,
    tokenBalanceRaw: tokenBalanceRaw.toString(),
    tokenBalanceDecimal: formatUnits(tokenBalanceRaw, config.decimals),
    gasStatus,
  };
}
