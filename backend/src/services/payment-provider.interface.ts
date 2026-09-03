// Payment Provider Interface - Abstraction layer for payment providers
// Currently: USDT (BNB Smart Chain / BEP-20)
// Future: Aureond Blockchain
// This allows providers to be interchangeable without changing business logic

export interface PaymentProvider {
  processPayout(amount: number, walletAddress: string, currency: string): Promise<{ transactionId: string; status: string }>;
  getTransactionStatus(txId: string): Promise<{ status: string; confirmations: number }>;
  validateAddress(address: string): Promise<boolean>;
  getMinimumWithdrawal(): number;
  getSupportedCurrencies(): string[];
  getProviderName(): string;
}

// USDT on BNB Smart Chain (BEP-20) Provider
export class USDTBEP20Provider implements PaymentProvider {
  private readonly MIN_WITHDRAWAL_USD = 20;
  private readonly SUPPORTED_CURRENCIES = ['USDT'];
  private readonly NETWORK = 'BNB_SMART_CHAIN';
  private readonly BEP20_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

  async processPayout(amount: number, walletAddress: string, currency: string): Promise<{ transactionId: string; status: string }> {
    // Validate minimum amount
    if (amount < this.MIN_WITHDRAWAL_USD) {
      throw new Error(`Minimum withdrawal is $${this.MIN_WITHDRAWAL_USD} USD`);
    }

    // Validate currency
    if (currency !== 'USDT') {
      throw new Error(`Unsupported currency: ${currency}. Only USDT is supported.`);
    }

    // Validate wallet address
    const isValid = await this.validateAddress(walletAddress);
    if (!isValid) {
      throw new Error('Invalid USDT (BEP-20) wallet address');
    }

    // In production, integrate with blockchain API (e.g., Binance API, third-party service)
    // For now, return a mock transaction
    return {
      transactionId: `TX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'PENDING',
    };
  }

  async getTransactionStatus(txId: string): Promise<{ status: string; confirmations: number }> {
    // In production, check blockchain explorer API
    return {
      status: 'PENDING',
      confirmations: 0,
    };
  }

  async validateAddress(address: string): Promise<boolean> {
    // BEP-20 addresses are 0x-prefixed 40-character hex strings
    if (!address || typeof address !== 'string') return false;
    return this.BEP20_ADDRESS_REGEX.test(address.trim());
  }

  getMinimumWithdrawal(): number {
    return this.MIN_WITHDRAWAL_USD;
  }

  getSupportedCurrencies(): string[] {
    return [...this.SUPPORTED_CURRENCIES];
  }

  getProviderName(): string {
    return `USDT (${this.NETWORK})`;
  }
}

// Future: Aureond Blockchain Provider
// export class AureondProvider implements PaymentProvider {
//   async processPayout(amount: number, walletAddress: string, currency: string): Promise<...> { ... }
//   async getTransactionStatus(txId: string): Promise<...> { ... }
//   async validateAddress(address: string): Promise<boolean> { ... }
//   getMinimumWithdrawal(): number { return 10; }
//   getSupportedCurrencies(): string[] { return ['AUREOND']; }
//   getProviderName(): string { return 'Aureond Blockchain'; }
// }

// Factory for interchangeable payment providers
export class PaymentProviderFactory {
  private static providers: Map<string, PaymentProvider> = new Map();
  private static defaultProvider: string = 'USDT_BEP20';

  static {
    // Register default provider
    PaymentProviderFactory.providers.set('USDT_BEP20', new USDTBEP20Provider());
  }

  static getProvider(type?: string): PaymentProvider {
    const key = type || PaymentProviderFactory.defaultProvider;
    const provider = PaymentProviderFactory.providers.get(key);
    if (!provider) {
      throw new Error(`Payment provider '${key}' not registered`);
    }
    return provider;
  }

  static registerProvider(type: string, provider: PaymentProvider): void {
    PaymentProviderFactory.providers.set(type, provider);
  }

  static setDefaultProvider(type: string): void {
    if (!PaymentProviderFactory.providers.has(type)) {
      throw new Error(`Cannot set default: provider '${type}' not registered`);
    }
    PaymentProviderFactory.defaultProvider = type;
  }

  static getAvailableProviders(): string[] {
    return Array.from(PaymentProviderFactory.providers.keys());
  }
}