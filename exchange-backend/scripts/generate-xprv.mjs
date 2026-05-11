// node scripts/generate-xprv.mjs
import * as bip39 from 'bip39';
import * as secp from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';

const bip32 = BIP32Factory(secp);

const mnemonic = bip39.generateMnemonic(256);        // 24-word dev mnemonic
const seed = await bip39.mnemonicToSeed(mnemonic);

// Use the *account* node for EVM chains: m/44'/60'/0'
const root = bip32.fromSeed(seed);
const accountNode = root.derivePath("m/44'/60'/0'");

const xprv = accountNode.toBase58();
const xpub = accountNode.neutered().toBase58();

console.log('\n=== DEV KEYS (DO NOT USE IN PROD) ===');
console.log('Mnemonic:  ', mnemonic);
console.log('XPRV:      ', xprv);
console.log('XPUB:      ', xpub);
console.log('\nStore MASTER_XPRV in your .env. Keep mnemonic OFF your repo.\n');
