function amount(n:number):number { if (!Number.isSafeInteger(n) || n<0 || n>1_000_000_000) throw Error('invalid_amount'); return n; }
/** All inputs use the SAME currency's smallest unit; conversion is recorded before this call. */
export function marginSplit(input:{revenue:number;tax:number;fees:number;providerCost:number;creator:boolean}) {
  const margin=Math.max(0,amount(input.revenue)-amount(input.tax)-amount(input.fees)-amount(input.providerCost));
  const creator=input.creator?Math.floor(margin*80/100):0;
  return {margin,creator,platform:margin-creator};
}
export function rewardQuote(input:{platformMargin:number;costPerCredit:number;cap:number}) {
  amount(input.platformMargin);amount(input.costPerCredit);amount(input.cap);
  if (!input.costPerCredit) throw Error('invalid_cost');
  const credits=Math.min(input.cap,Math.floor(input.platformMargin/input.costPerCredit));
  return {credits,liability:credits*input.costPerCredit,remaining:input.platformMargin-credits*input.costPerCredit};
}
