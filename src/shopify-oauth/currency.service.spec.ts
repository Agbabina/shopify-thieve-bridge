import { BadRequestException } from '@nestjs/common';
import { CurrencyService } from './currency.service';

describe('CurrencyService', () => {
  let service: CurrencyService;
  beforeEach(() => { service = new CurrencyService(); });

  it('returns one for identical currencies', async () => {
    await expect(service.getRate('NGN', 'NGN')).resolves.toMatchObject({
      from: 'NGN', to: 'NGN', rate: 1, source: 'identity',
    });
  });

  it('accepts a positive manual rate without calling an FX provider', async () => {
    await expect(service.getRate('USD', 'NGN', '1540.5')).resolves.toMatchObject({
      rate: 1540.5, source: 'manual',
    });
  });

  it('rejects invalid currency codes', async () => {
    await expect(service.getRate('US D', 'NGN')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects zero or negative manual rates', async () => {
    await expect(service.getRate('USD', 'NGN', '0')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses a clearly marked stale cached rate if the provider goes down', async () => {
    let now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: 'success',
          rates: { NGN: 1500 },
          time_last_update_utc: 'Mon, 01 Jan 2026 00:00:00 +0000',
        }),
      } as Response)
      .mockRejectedValueOnce(new Error('provider offline'));

    try {
      await expect(service.getRate('USD', 'NGN')).resolves.toMatchObject({
        rate: 1500, source: 'market-rate',
      });
      now += 11 * 60 * 1000;
      await expect(service.getRate('USD', 'NGN')).resolves.toMatchObject({
        rate: 1500, source: 'stale-cache', stale: true,
      });
    } finally {
      fetchSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });
});
