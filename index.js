// === index.js ===
import {
  JsonRpcProvider,
  Wallet,
  Contract,
  parseUnits,
  formatUnits
} from 'ethers';
import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

// === Konfigurasi ===
const RPC_URL = "https://api.zan.top/node/v1/pharos/testnet/1311fbe804cc47e4a02e66a76d9c5d7b";
const USDC_ADDRESS = "0xad902cf99c2de2f1ba5ec4d642fd7e49cae9ee37";
const WPHRS_ADDRESS = "0x76aaada469d23216be5f7c596fa25f282ff9b364";
const ROUTERS = {
  zenith: "0x1a4de519154ae51200b0ad7c90f7fac75547888a",
  faroswap: "0x3541423f25a1ca5c98fdbcf478405d3f0aad1164"
};
const CHECKIN_URL = "https://api.pharosnetwork.xyz/api/daily/check-in";
const DECIMALS = 18;

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const AMOUNT_SEND = config.amountSend || "0.001";
const AMOUNT_SWAP = config.amountSwap || "0.2";
const SWAP_TIMES = config.swapTimes || 1;
const AMOUNT_LIQUIDITY = config.amountLiquidity || "0.1";
const SELECTED_ROUTER = ROUTERS[config.useRouter || "zenith"];

const provider = new JsonRpcProvider(RPC_URL);

// === ABIs ===
const erc20Abi = [
  "function transfer(address to, uint amount) public returns (bool)",
  "function approve(address spender, uint amount) public returns (bool)",
  "function balanceOf(address account) public view returns (uint256)"
];

const routerAbi = [
  "function swapExactTokensForTokens(uint, uint, address[], address, uint) external returns (uint[] memory)",
  "function addLiquidity(address, address, uint, uint, uint, uint, address, uint) external returns (uint, uint, uint)"
];

// === Log per wallet ===
function logToFile(walletAddress, message) {
  const logPath = `logs/${walletAddress}.log`;
  fs.mkdirSync('logs', { recursive: true });
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

// === Fungsi Kirim WPHRS ke 10 address ===
async function sendTokens(wphrs, wallet) {
  const addresses = fs.readFileSync('addresses.txt', 'utf-8')
    .split('\n').map(a => a.trim()).filter(Boolean)
    .sort(() => Math.random() - 0.5)
    .slice(0, 10);

  const amount = parseUnits(AMOUNT_SEND, DECIMALS);
  const balance = await wphrs.balanceOf(wallet.address);
  const total = amount * BigInt(addresses.length);

  if (balance < total) {
    console.log("❌ Saldo WPHRS tidak cukup untuk kirim.");
    logToFile(wallet.address, `Saldo WPHRS tidak cukup: ${formatUnits(balance)}`);
    return;
  }

  for (let to of addresses) {
    try {
      const tx = await wphrs.transfer(to, amount);
      console.log(`📤 Kirim ${AMOUNT_SEND} WPHRS ke ${to}`);
      logToFile(wallet.address, `Transfer ke ${to}: ${tx.hash}`);
      await tx.wait();
    } catch (err) {
      console.error("❌ Gagal kirim:", err.message);
      logToFile(wallet.address, `Transfer gagal ke ${to}: ${err.message}`);
    }
  }
}

// === Fungsi Swap Token ===
async function swapTokens(usdc, router, wallet) {
  const amountIn = parseUnits(AMOUNT_SWAP, DECIMALS);
  const totalNeeded = amountIn * BigInt(SWAP_TIMES);
  const balance = await usdc.balanceOf(wallet.address);

  if (balance < totalNeeded) {
    console.log(`❌ Saldo USDC tidak cukup untuk swap ${SWAP_TIMES}x`);
    logToFile(wallet.address, `Saldo USDC kurang: ${formatUnits(balance)}`);
    return;
  }

  const path = [USDC_ADDRESS, WPHRS_ADDRESS];
  const deadline = Math.floor(Date.now() / 1000) + 600;

  for (let i = 1; i <= SWAP_TIMES; i++) {
    try {
      await usdc.approve(SELECTED_ROUTER, amountIn);
      const tx = await router.swapExactTokensForTokens(amountIn, 0, path, wallet.address, deadline);
      console.log(`🔄 Swap #${i}: ${AMOUNT_SWAP} USDC -> WPHRS`);
      logToFile(wallet.address, `Swap #${i} TX: ${tx.hash}`);
      await tx.wait();
    } catch (err) {
      console.error(`❌ Swap #${i} gagal:`, err.message);
      logToFile(wallet.address, `Swap #${i} error: ${err.message}`);
    }
  }
}

// === Fungsi Tambah Liquidity ===
async function addLiquidity(usdc, wphrs, router, wallet) {
  const amount = parseUnits(AMOUNT_LIQUIDITY, DECIMALS);
  const balUSDC = await usdc.balanceOf(wallet.address);
  const balWPHRS = await wphrs.balanceOf(wallet.address);

  if (balUSDC < amount || balWPHRS < amount) {
    console.log("❌ Saldo tidak cukup untuk add liquidity.");
    logToFile(wallet.address, `LP gagal: USDC=${formatUnits(balUSDC)}, WPHRS=${formatUnits(balWPHRS)}`);
    return;
  }

  const deadline = Math.floor(Date.now() / 1000) + 600;
  try {
    await usdc.approve(SELECTED_ROUTER, amount);
    await wphrs.approve(SELECTED_ROUTER, amount);
    const tx = await router.addLiquidity(USDC_ADDRESS, WPHRS_ADDRESS, amount, amount, 0, 0, wallet.address, deadline);
    console.log("💧 Add Liquidity sukses");
    logToFile(wallet.address, `LP TX: ${tx.hash}`);
    await tx.wait();
  } catch (err) {
    console.error("❌ LP error:", err.message);
    logToFile(wallet.address, `LP error: ${err.message}`);
  }
}

// === Fungsi Daily Check-in ===
async function dailyCheckIn(wallet) {
  try {
    const res = await axios.post(CHECKIN_URL, { address: wallet.address });
    console.log("📅 Check-in:", res.data);
    logToFile(wallet.address, `Check-in: ${JSON.stringify(res.data)}`);
  } catch (err) {
    console.error("❌ Check-in gagal:", err.message);
    logToFile(wallet.address, `Check-in error: ${err.message}`);
  }
}

// === Load Private Keys ===
const privateKeys = process.env.PRIVATE_KEYS?.split(',').map(k => k.trim()).filter(Boolean);
if (!privateKeys || privateKeys.length === 0) {
  console.error("❌ PRIVATE_KEYS belum diatur di .env");
  process.exit(1);
}

// === Eksekusi Utama ===
(async () => {
  for (const key of privateKeys) {
    const wallet = new Wallet(key, provider);
    console.log(`\n🚀 Mulai untuk wallet: ${wallet.address}`);
    logToFile(wallet.address, `=== Eksekusi baru dimulai ===`);

    const usdc = new Contract(USDC_ADDRESS, erc20Abi, wallet);
    const wphrs = new Contract(WPHRS_ADDRESS, erc20Abi, wallet);
    const router = new Contract(SELECTED_ROUTER, routerAbi, wallet);

    await sendTokens(wphrs, wallet);
    await swapTokens(usdc, router, wallet);
    await addLiquidity(usdc, wphrs, router, wallet);
    await dailyCheckIn(wallet);
  }
})();
