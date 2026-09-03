import { API_BASE_URL, ApiResponse, authHeaders } from './api';

const WALLET_URL = `${API_BASE_URL}/api/wallets`;

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// ============================================================================
// WALLET
// ============================================================================

export async function getWallet() {
  const res = await fetch(`${WALLET_URL}/me`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

export async function getBalance() {
  const res = await fetch(`${WALLET_URL}/balance`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

// ============================================================================
// DEPOSITS
// ============================================================================

export async function processDeposit(data: {
  amount: number;
  coins: number;
  paymentMethod: string;
  providerOrderId: string;
}) {
  const res = await fetch(`${WALLET_URL}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function getDeposits(limit = 50, offset = 0) {
  const res = await fetch(`${WALLET_URL}/deposits?limit=${limit}&offset=${offset}`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

// ============================================================================
// TRANSFERS
// ============================================================================

export async function transferCoins(data: {
  receiverId: string;
  amount: number;
  note?: string;
  pin?: string;
  otpCode?: string;
}) {
  const res = await fetch(`${WALLET_URL}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function getTransfersSent(limit = 50, offset = 0) {
  const res = await fetch(`${WALLET_URL}/transfers/sent?limit=${limit}&offset=${offset}`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

export async function getTransfersReceived(limit = 50, offset = 0) {
  const res = await fetch(`${WALLET_URL}/transfers/received?limit=${limit}&offset=${offset}`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

// ============================================================================
// PIN MANAGEMENT
// ============================================================================

export async function setupPin(pin: string) {
  const res = await fetch(`${WALLET_URL}/pin/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify({ pin }),
  });
  return handleResponse(res);
}

export async function updatePin(oldPin: string, newPin: string) {
  const res = await fetch(`${WALLET_URL}/pin/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify({ oldPin, newPin }),
  });
  return handleResponse(res);
}

export async function verifyPin(pin: string) {
  const res = await fetch(`${WALLET_URL}/pin/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify({ pin }),
  });
  return handleResponse(res);
}

// ============================================================================
// TRANSFER LIMITS
// ============================================================================

export async function updateTransferLimit(data: {
  dailyLimit?: number;
  singleTxLimit?: number;
  otpThreshold?: number;
}) {
  const res = await fetch(`${WALLET_URL}/limits`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

// ============================================================================
// TRANSACTION HISTORY
// ============================================================================

export async function getTransactionHistory(params?: {
  type?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
  }
  const res = await fetch(`${WALLET_URL}/transactions?${query}`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

export async function getGiftHistory(limit = 50) {
  const res = await fetch(`${WALLET_URL}/gift-history?limit=${limit}`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

// ============================================================================
// WITHDRAWALS
// ============================================================================

export async function requestWithdrawal(amount: number, walletAddress: string) {
  const res = await fetch(`${WALLET_URL}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify({ amount, walletAddress }),
  });
  return handleResponse(res);
}

export async function getWithdrawals(limit = 20) {
  const res = await fetch(`${WALLET_URL}/withdrawals?limit=${limit}`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

// ============================================================================
// WALLET ADDRESS
// ============================================================================

export async function saveWalletAddress(address: string) {
  const res = await fetch(`${WALLET_URL}/address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify({ address }),
  });
  return handleResponse(res);
}

// ============================================================================
// COIN PACKAGES (Buy Coins)
// ============================================================================

export async function getCoinPackages() {
  const res = await fetch(`${WALLET_URL}/packages`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

export async function getPaymentAddress(data: {
  packageId: string;
  network: string;
  amount: number;
}) {
  const res = await fetch(`${WALLET_URL}/payment-address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function verifyPayment(data: {
  orderId?: string;
  txHash?: string;
  packageId?: string;
  network?: string;
}) {
  const res = await fetch(`${WALLET_URL}/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(getToken()) },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

// ============================================================================
// USER SEARCH (Send Coins)
// ============================================================================

export async function searchWalletUsers(query: string) {
  const res = await fetch(`${WALLET_URL}/users/search?q=${encodeURIComponent(query)}`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}

// ============================================================================
// ANALYTICS
// ============================================================================

export async function getWalletAnalytics() {
  const res = await fetch(`${WALLET_URL}/analytics`, {
    headers: { ...authHeaders(getToken()) },
  });
  return handleResponse(res);
}
