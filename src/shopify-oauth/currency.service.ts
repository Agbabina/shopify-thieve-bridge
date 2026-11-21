import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';

type CachedRate = { rate: number; at: number; fetchedAt: string };

@Injectable()
export class CurrencyService {
  private readonly cache = new Map<string, CachedRate>();
  private readonly freshForMs = 10 * 60 * 1000;
  private readonly staleForMs = 24 * 60 * 60 * 1000;

  async getRate(fromInput: string, toInput: string, manualRate?: string) {
    const from = String(fromInput || '').trim().toUpperCase();
    const to = String(toInput || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      throw new BadRequestException('Use three-letter ISO currency codes such as USD and NGN.');
    }

    if (manualRate !== undefined && manualRate !== '') {
      const rate = Number(manualRate);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new BadRequestException('Manual rate must be greater than zero.');
      }
      return { from, to, rate: from === to ? 1 : rate, source: 'manual', fetchedAt: new Date().toISOString() };
    }
    if (from === to) {
      return { from, to, rate: 1, source: 'identity', fetchedAt: new Date().toISOString() };
    }

    const key = from + ':' + to;
    const cached = this.cache.get(key);
    const age = cached ? Date.now() - cached.at : Number.POSITIVE_INFINITY;
    if (cached && age <= this.freshForMs) {
      return { from, to, rate: cached.rate, source: 'cached-market-rate', fetchedAt: cached.fetchedAt };
    }

    try {
      const response = await fetch('https://open.er-api.com/v6/latest/' + encodeURIComponent(from), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('FX provider returned HTTP ' + response.status);
      const data = await response.json() as {
        result?: string;
        rates?: Record<string, number>;
        time_last_update_utc?: string;
      };
      const rate = Number(data.rates?.[to]);
      if (data.result !== 'success' || !Number.isFinite(rate) || rate <= 0) {
        throw new Error('The provider did not return a valid rate for ' + key);
      }
      const fetchedAt = data.time_last_update_utc || new Date().toISOString();
      this.cache.set(key, { rate, at: Date.now(), fetchedAt });
      return { from, to, rate, source: 'market-rate', fetchedAt };
    } catch {
      if (cached && age <= this.staleForMs) {
        return {
          from,
          to,
          rate: cached.rate,
          source: 'stale-cache',
          fetchedAt: cached.fetchedAt,
          stale: true,
        };
      }
      throw new ServiceUnavailableException(
        'Could not load ' + key + '. Enter a manual rate or retry when the FX provider is available.',
      );
    }
  }
}
