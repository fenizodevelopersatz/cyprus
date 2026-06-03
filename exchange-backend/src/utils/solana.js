import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

const DEFAULT_RPC_BY_CLUSTER = {
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

const DEFAULT_USDC_MINT_BY_CLUSTER = {
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  testnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

export function getSolanaCluster(assetConfig = {}) {
  return String(assetConfig.chainId || assetConfig.chain_id || process.env.NETWORK || process.env.SOLANA_NETWORK || 'devnet')
    .trim()
    .toLowerCase();
}

export function getSolanaRpcUrl(assetConfig = {}) {
  const cluster = getSolanaCluster(assetConfig);
  const envKey =
    cluster === 'mainnet' || cluster === 'mainnet-beta'
      ? 'SOLANA_MAINNET_RPC'
      : cluster === 'testnet'
        ? 'SOLANA_TESTNET_RPC'
        : 'SOLANA_DEVNET_RPC';
  return String(
    assetConfig.rpcUrl ||
      assetConfig.rpc_url ||
      assetConfig.fullHost ||
      assetConfig.full_host ||
      process.env.SOLANA_RPC_URL ||
      process.env[envKey] ||
      DEFAULT_RPC_BY_CLUSTER[cluster] ||
      DEFAULT_RPC_BY_CLUSTER.devnet
  ).trim();
}

export function getSolanaTokenMint(assetConfig = {}) {
  const cluster = getSolanaCluster(assetConfig);
  return String(
    assetConfig.contractAddress ||
      assetConfig.contract_address ||
      process.env.SOLANA_TOKEN_MINT ||
      process.env.SOLANA_USDC_MINT ||
      (cluster === 'testnet' ? process.env.SOLANA_TESTNET_USDC_MINT : '') ||
      DEFAULT_USDC_MINT_BY_CLUSTER[cluster] ||
      DEFAULT_USDC_MINT_BY_CLUSTER.devnet
  ).trim();
}

export function createSolanaConnection(assetConfig = {}) {
  return new Connection(getSolanaRpcUrl(assetConfig), 'confirmed');
}

export function createSolanaWallet() {
  const keypair = Keypair.generate();
  return {
    address: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
  };
}

export function createSolanaWalletFromMnemonic(mnemonic, path = process.env.SOLANA_DERIVATION_PATH || "m/44'/501'/0'/0'") {
  const seed = bip39.mnemonicToSeedSync(String(mnemonic || '').trim());
  const derived = derivePath(path, seed.toString('hex')).key;
  const keypair = Keypair.fromSeed(derived);
  return {
    address: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
  };
}

export function getSolanaKeypair(privateKey) {
  const raw = String(privateKey || '').trim();
  if (!raw) {
    const err = new Error('SOLANA_PRIVATE_KEY_REQUIRED');
    err.status = 400;
    throw err;
  }

  try {
    const decoded = bs58.decode(raw);
    return Keypair.fromSecretKey(decoded);
  } catch {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return Keypair.fromSecretKey(Uint8Array.from(parsed));
    } catch {}
  }

  const err = new Error('INVALID_SOLANA_PRIVATE_KEY');
  err.status = 400;
  throw err;
}

export function isValidSolanaAddress(address) {
  try {
    const publicKey = new PublicKey(String(address || '').trim());
    return PublicKey.isOnCurve(publicKey.toBytes());
  } catch {
    return false;
  }
}

export function isValidSolanaSignature(signature) {
  try {
    const decoded = bs58.decode(String(signature || '').trim());
    return decoded.length === 64;
  } catch {
    return false;
  }
}

export async function getSolanaAssociatedTokenAddress(ownerAddress, mintAddress) {
  return getAssociatedTokenAddress(
    new PublicKey(mintAddress),
    new PublicKey(ownerAddress),
    false,
    TOKEN_PROGRAM_ID
  );
}

export async function getSolanaTokenBalanceRaw(ownerAddress, assetConfig = {}) {
  const connection = createSolanaConnection(assetConfig);
  const mint = getSolanaTokenMint(assetConfig);
  const tokenAddress = await getSolanaAssociatedTokenAddress(ownerAddress, mint);
  try {
    const account = await getAccount(connection, tokenAddress);
    return BigInt(account.amount.toString());
  } catch (error) {
    if (
      error?.name === 'TokenAccountNotFoundError' ||
      /could not find account|TokenAccountNotFound/i.test(String(error?.message || error))
    ) {
      return 0n;
    }
    throw error;
  }
}

export async function getSolanaNativeBalanceRaw(ownerAddress, assetConfig = {}) {
  const connection = createSolanaConnection(assetConfig);
  return BigInt(await connection.getBalance(new PublicKey(ownerAddress), 'confirmed'));
}

export async function sendSolanaLamports({ fromPrivateKey, toAddress, lamports, assetConfig = {} }) {
  const connection = createSolanaConnection(assetConfig);
  const from = getSolanaKeypair(fromPrivateKey);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports: Number(lamports),
    })
  );
  return sendAndConfirmTransaction(connection, tx, [from], { commitment: 'confirmed' });
}

export async function transferSolanaToken({ fromPrivateKey, toAddress, amountRaw, assetConfig = {} }) {
  const connection = createSolanaConnection(assetConfig);
  const from = getSolanaKeypair(fromPrivateKey);
  const mint = new PublicKey(getSolanaTokenMint(assetConfig));
  const destinationOwner = new PublicKey(toAddress);
  const sourceToken = await getAssociatedTokenAddress(mint, from.publicKey);
  const destinationToken = await getAssociatedTokenAddress(mint, destinationOwner);
  const tx = new Transaction();
  const destinationAccount = await connection.getAccountInfo(destinationToken);

  if (!destinationAccount) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        from.publicKey,
        destinationToken,
        destinationOwner,
        mint
      )
    );
  }

  tx.add(
    createTransferInstruction(
      sourceToken,
      destinationToken,
      from.publicKey,
      BigInt(amountRaw)
    )
  );

  return sendAndConfirmTransaction(connection, tx, [from], { commitment: 'confirmed' });
}

export async function confirmSolanaSignature(signature, assetConfig = {}) {
  const connection = createSolanaConnection(assetConfig);
  const status = await connection.getSignatureStatus(String(signature || '').trim(), {
    searchTransactionHistory: true,
  });
  const value = status?.value || null;
  return {
    confirmed: Boolean(value && !value.err && ['confirmed', 'finalized'].includes(value.confirmationStatus)),
    receipt: value,
  };
}

export function lamportsFromDecimal(amountDecimal) {
  return BigInt(Math.round(Number(amountDecimal || 0) * 1_000_000_000));
}

export function decimalFromLamports(lamports) {
  return (Number(lamports || 0n) / 1_000_000_000).toString();
}
