import { ethers } from 'ethers';
import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

// ========== Konstanta Blockchain ==========
const RPC_URL = "https://api.zan.top/node/v1/pharos/testnet/1761472bf26745488907477d23719fb5";
const USDC_ADDRESS = "0xad902cf99c2de2f1ba5ec4d642fd7e49cae9ee37";
const WPHRS_ADDRESS = "0x76aaada469d23216be5f7c596fa25f282ff9b364";
const ROUTER_ADDRESS = "0x1a4de519154ae51200b0ad7c90f7fac75547888a";
const LP_ADDRESS = "0xF8a1D4FF0f9b9Af7CE58E1fc1833688F3BFd6115";
const FAUCET_URL = "https://testnet-router.zenithswap.xyz/api/v1/faucet";
const CHECKIN_URL = "https://api.pharosnetwork.xyz/api/daily/check-in";
const DECIMALS = 18;

// ========== Load Config ==========
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const AMOUNT_SEND = config.amountSend || "1.0";
const AMOUNT_SWAP = config.amountSwap || "1.0";
const AMOUNT_LIQUIDITY = config.amountLiquidity || "1.0";

// ========== Setup Wallet ==========
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("❌ PRIVATE_KEY belum diatur di .env");
  process.exit(1);
}
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// ========== ABIs ==========
const erc20Abi = [
  "function transfer(address to, uint amount) public returns (bool)",
  "function approve(address spender, uint amount) public returns (bool)",
  "function balanceOf(address account) public view returns (uint256)",
  "function decimals() public view returns (uint8)"
];
const routerAbi = [
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)"
];

// ========== Contracts ==========
const usdc = new ethers.Contract(USDC_ADDRESS, erc20Abi, wallet);
const wphrs = new ethers.Contract(WPHRS_ADDRESS, erc20Abi, wallet);
const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, wallet);

// ========== Fungsi Utama ==========

// ✅ 1. Ambil token dari faucet
async function claimFaucet() {
  try {
    const res = await axios.post(FAUCET_URL, { address: wallet.address });
    console.log(`🚰 Faucet response:`, res.data);
  } catch (err) {
    console.error(`❌ Faucet error: ${err.message}`);
  }
}

// ✅ 2. Kirim token ke banyak alamat
async function sendTokens() {
  const addresses = fs.readFileSync('addresses.txt', 'utf-8')
    .split('\n')
    .map(a => a.trim())
    .filter(Boolean);

  const amount = ethers.utils.parseUnits(AMOUNT_SEND, DECIMALS);
  for (let i = 0; i < addresses.length; i++) {
    const to = addresses[i];
    try {
      console.log(`📤 Kirim ${AMOUNT_SEND} USDC ke ${to} (${i + 1})`);
      const tx = await usdc.transfer(to, amount);
      console.log(`⏳ TX: ${tx.hash}`);
      await tx.wait();
      console.log(`✅ Sukses`);
    } catch (err) {
      console.error(`❌ Gagal kirim ke ${to}: ${err.message}`);
    }
  }
}

// ✅ 3. Swap USDC → WPHRS
async function swapTokens() {
  const amountIn = ethers.utils.parseUnits(AMOUNT_SWAP, DECIMALS);
  const path = [USDC_ADDRESS, WPHRS_ADDRESS];
  const deadline = Math.floor(Date.now() / 1000) + 600;

  await usdc.approve(ROUTER_ADDRESS, amountIn);
  console.log(`🌀 Disetujui swap ${AMOUNT_SWAP} USDC`);

  const tx = await router.swapExactTokensForTokens(
    amountIn, 0, path, wallet.address, deadline
  );

  console.log(`⏳ Swap TX: ${tx.hash}`);
  await tx.wait();
  console.log(`✅ Swap sukses`);
}

// ✅ 4. Tambah Liquidity
async function addLiquidity() {
  const amountA = ethers.utils.parseUnits(AMOUNT_LIQUIDITY, DECIMALS);
  const amountB = ethers.utils.parseUnits(AMOUNT_LIQUIDITY, DECIMALS);
  const deadline = Math.floor(Date.now() / 1000) + 600;

  await usdc.approve(ROUTER_ADDRESS, amountA);
  await wphrs.approve(ROUTER_ADDRESS, amountB);
  console.log(`🌀 Disetujui tambah likuiditas`);

  const tx = await router.addLiquidity(
    USDC_ADDRESS, WPHRS_ADDRESS,
    amountA, amountB,
    0, 0,
    wallet.address,
    deadline
  );

  console.log(`⏳ LP TX: ${tx.hash}`);
  await tx.wait();
  console.log(`✅ Likuiditas ditambahkan`);
}

// ✅ 5. Daily Check-In
async function dailyCheckIn() {
  try {
    const res = await axios.post(CHECKIN_URL, { address: wallet.address });
    console.log(`📅 Check-in:`, res.data);
  } catch (err) {
    console.error(`❌ Gagal check-in: ${err.message}`);
  }
}

// ========== Jalankan Semua ==========
(async () => {
  console.log(`👛 Wallet: ${wallet.address}\n`);
  await claimFaucet();
  await sendTokens();
  await swapTokens();
  await addLiquidity();
  await dailyCheckIn();
  console.log(`🏁 Semua aksi selesai.`);
})();
