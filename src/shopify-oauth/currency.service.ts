import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
@Injectable()
export class CurrencyService {
  private cache = new Map<string, { rate: number; at: number }>();
  async getRate(fromInput: string, toInput: string, manualRate?: string) {
    const from=String(fromInput||'').trim().toUpperCase(), to=String(toInput||'').trim().toUpperCase();
    if(!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to)) throw new BadRequestException('Use three-letter ISO currency codes such as USD and NGN.');
    if(manualRate!==undefined&&manualRate!==''){const rate=Number(manualRate);if(!Number.isFinite(rate)||rate<=0)throw new BadRequestException('Manual rate must be greater than zero.');return {from,to,rate:from===to?1:rate,source:'manual',fetchedAt:new Date().toISOString()};}
    if(from===to)return {from,to,rate:1,source:'identity',fetchedAt:new Date().toISOString()};
    const key=from+':'+to, cached=this.cache.get(key);
    if(cached&&Date.now()-cached.at<600000)return {from,to,rate:cached.rate,source:'cached-market-rate',fetchedAt:new Date(cached.at).toISOString()};
    try{
      const response=await fetch('https://open.er-api.com/v6/latest/'+encodeURIComponent(from),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw new Error('FX provider HTTP '+response.status);
      const data=await response.json() as {result?:string;rates?:Record<string,number>;time_last_update_utc?:string};
      const rate=Number(data.rates?.[to]);if(data.result!=='success'||!Number.isFinite(rate)||rate<=0)throw new Error('Rate unavailable for '+key);
      this.cache.set(key,{rate,at:Date.now()});return {from,to,rate,source:'market-rate',fetchedAt:data.time_last_update_utc||new Date().toISOString()};
    }catch(error){throw new ServiceUnavailableException('Could not load '+key+'. Enter a manual rate to continue. '+(error instanceof Error?error.message:''));}
  }
}