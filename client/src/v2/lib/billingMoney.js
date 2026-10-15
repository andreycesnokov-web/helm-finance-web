const digits=currency=>new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
export function minorToInput(value,currency='USD'){
 const n=digits(currency),s=String(value);if(!/^\d+$/.test(s))return '';
 if(!n)return s;const p=s.padStart(n+1,'0');return p.slice(0,-n)+'.'+p.slice(-n);
}
export function inputToMinor(value,currency='USD'){
 try{const n=digits(currency),s=String(value).trim().replace(',','.');if(!/^\d+(?:\.\d+)?$/.test(s))return null;
  const [a,b='']=s.split('.');if(b.length>n)return null;const amount=BigInt(a+b.padEnd(n,'0'));if(amount>BigInt(Number.MAX_SAFE_INTEGER))return null;return amount.toString();
 }catch{return null}
}
export const priceLabel=(value,currency,lang)=>new Intl.NumberFormat(lang,{style:'currency',currency}).format(Number(minorToInput(value,currency)));
