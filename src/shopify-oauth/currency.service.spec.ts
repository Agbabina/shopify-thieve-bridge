import { BadRequestException } from '@nestjs/common';
import { CurrencyService } from './currency.service';

describe('CurrencyService', () => {
  let service: CurrencyService;
  beforeEach(() => { service = new CurrencyService(); });

  it('returns one for identical currencies', async () => {
    await expect(service.getRate('NGN', 'NGN')).resolves.toMatchObject({ from: 'NGN', to: 'NGN', rate: 1, source: 'identity' });
  });

  it('accepts a positive manual rate without calling an FX provider', async () => {
    await expect(service.getRate('USD', 'NGN', '1540.5')).resolves.toMatchObject({ rate: 1540.5, source: 'manual' });
  });

  it('rejects invalid currency codes', async () => {
    await expect(service.getRate('US D', 'NGN')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects zero or negative manual rates', async () => {
    await expect(service.getRate('USD', 'NGN', '0')).rejects.toBeInstanceOf(BadRequestException);
  });
});
