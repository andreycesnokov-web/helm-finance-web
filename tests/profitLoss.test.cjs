const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildReport,options,exact}=require('../server/lib/profitLoss');
const M=require('../server/lib/transactionClass'),{B,OTHER,fixture,tx,cat}=require('./fixtures/profitLoss.cjs');
const run=(f=fixture(),opts={})=>buildReport(f,{businessId:B,month:'2026-08',compare:'2026-07',currency:'IDR',...opts});
test('exact arithmetic, refunds, costs, payroll and tax cash; no fabricated Net Profit',()=>{
 const r=run(),t=r.periods['2026-08'].totals;
 assert.deepEqual(t,{revenue:'975.1',direct_cost:'200.2',gross:'774.9',operating_cost:'170.7',ebitda:'604.2',other_income:'5',interest:'10',tax:'20',cash_result:'579.2',net_profit:null,depreciation:null});
 assert.equal(r.accounting_ready,false);assert.equal(r.capabilities.accrual,false);assert.equal(r.capabilities.trial_balance,false);
 assert.equal(r.periods['2026-07'].totals.operating_cost,'0.1');
});
test('every category, group and period sum is exactly its expanded contributions',()=>{
 const r=run(),entries=new Map(r.entries.map(e=>[e.key,e]));
 for(const p of Object.values(r.periods))for(const g of Object.values(p.groups)){
   for(const c of g.categories)assert.equal(c.total,c.entry_keys.reduce((n,k)=>M.addDec(n,entries.get(k).contribution),'0'));
   assert.equal(g.total,g.categories.reduce((n,c)=>M.addDec(n,c.total),'0'));
 }
});
test('paid bill + payment counted once; unpaid bill and draft payroll add nothing',()=>{
 const r=run(),e=r.entries.find(e=>e.transaction_id==='3');assert.equal(e.contribution,'100.3');assert.equal(e.bills.length,1);
 assert.equal(r.entries.filter(e=>e.transaction_id==='4').length,1);assert.equal(r.entries.some(e=>e.transaction_id==='draft'),false);
});
test('partial payments count cash paid only, never full bill amount',()=>{
 const f=fixture();f.debts[0].original_amount='1000';f.debts[0].status='partial';f.transactions.push(tx(20,'expense','50','Rent',{debt_payment_id:'501'}));
 assert.equal(run(f).periods['2026-08'].totals.operating_cost,'220.7');
});
test('normal settlement allocations enrich bill/doc lineage but never duplicate cash',()=>{
 const f=fixture();f.debts[0].linked_transaction_id=null;f.transactions[2].debt_payment_id=null;
 f.allocations=[{id:'alloc1',business_id:B,transaction_id:'3',debt_id:'501',settlement_source_type:'transaction',allocated_amount:'100.30'},
 {id:'alloc2',business_id:B,transaction_id:null,debt_id:'501',settlement_source_type:'withholding_record',allocated_amount:'100000'},
 {id:'bad',business_id:OTHER,transaction_id:'1',debt_id:'501',settlement_source_type:'transaction',allocated_amount:'1'}];
 const r=run(f),e=r.entries.find(e=>e.transaction_id==='3');assert.equal(e.bills[0].number,'SYN-501');assert.equal(e.documents[0].number,'SYN-RENT');assert.equal(r.periods['2026-08'].totals.cash_result,'579.2');
 assert.equal(r.entries.find(e=>e.transaction_id==='1').bills.length,0);
});
test('tenant boundaries hold for every evidence type and related reference',()=>{
 const r=run(),str=JSON.stringify(r);assert.ok(!str.includes('999999'));assert.ok(!str.includes('SECRET MUST NOT APPEAR'));assert.ok(!str.includes('foreignDoc'));
 const f=fixture();f.categories=f.categories.map(c=>({...c,business_id:OTHER}));assert.equal(run(f).entries.length,0);
});
test('own transfers, owner loan, CAPEX never become revenue or OPEX',()=>{
 const f=fixture();f.assets=[{id:'asset',business_id:B,purchase_transaction_id:'3'}];f.funding=[{id:'fund',business_id:B,received_transaction_id:'1'}];
 const r=run(f);assert.ok(!r.entries.some(e=>['1','3','10','11','12'].includes(e.transaction_id)));assert.ok(r.excluded.some(e=>e.reason==='capital_purchase'));
});
test('opening anchors and corrections excluded without inventing a reversal journal',()=>{
 const f=fixture();f.transactions=[tx(1,'income','999','Product sales',{is_opening_balance:true}),tx(2,'correction','-99','Rent'),tx(3,'income','99','Product sales',{source:'opening_reanchor_reversal'})];
 assert.equal(run(f).entries.length,0);assert.equal(run(f).excluded.length,3);
});
test('linked repayment containing principal and interest remains an explicit exception',()=>{
 const f=fixture();f.repayments=[{id:'repay',business_id:B,paid_transaction_id:'3'}];const r=run(f);
 assert.ok(r.exceptions.some(e=>e.reason==='repayment_split_not_verified'));assert.ok(!r.entries.some(e=>e.transaction_id==='3'));
});
test('currency stays native, no FX conversion or cross-currency addition',()=>{
 const r=run(undefined,{currency:'USD'});assert.equal(r.periods['2026-08'].totals.revenue,'99');assert.ok(r.entries.every(e=>e.currency==='USD'));
});
test('existing four-letter native currency codes are selectable without conversion',()=>{
 const f=fixture();f.transactions=[tx(1,'income','0.000001','Product sales',{currency_original:'USDT'})];
 const r=run(f,{currency:'USDT'});assert.equal(r.periods['2026-08'].totals.revenue,'0.000001');assert.deepEqual(r.currencies,['USDT']);
});
test('history chart periods use the same monthly contribution model',()=>{
 const r=run(undefined,{months:'2026-07,2026-08,2026-09'});assert.equal(r.periods['2026-07'].totals.operating_cost,'0.1');assert.equal(r.periods['2026-09'].totals.revenue,'0');
 for(const months of ['2026-08,2026-08','2026-08,broken','2024-01,2026-08'])assert.throws(()=>run(undefined,{months}));
});
test('unclassified, missing dates, unsafe amounts, negative magnitudes are explicit',()=>{
 const f=fixture();f.transactions.push(tx(31,'expense',1.01,'Rent'),tx(32,'expense','-1','Rent'),tx(33,'income','0.2','Product sales',{currency_original:null}));
 const r=run(f);for(const reason of ['unclassified_or_ambiguous_category','missing_transaction_date','invalid_or_inexact_amount','negative_magnitude_needs_review','missing_currency'])assert.ok(r.exceptions.some(e=>e.reason===reason),reason);
});
test('category IDs disambiguate same names, names alone fail closed',()=>{
 const f=fixture();f.categories.push(cat('rent2','Rent','direct_cost'));f.transactions=[tx(1,'expense','10','Rent'),tx(2,'expense','20','Rent',{cashflow_category_id:'rent'})];
 const r=run(f);assert.equal(r.entries.length,1);assert.equal(r.entries[0].contribution,'20');assert.equal(r.exceptions.length,1);
});
test('archived documents are not evidence; a link is not an approval or reconciliation',()=>{
 const r=run(),e=r.entries.find(e=>e.transaction_id==='3');assert.equal(e.documents[0].review_status,'needs_review');assert.equal(e.reconciliation_status,'statement_linked_not_reconciled');assert.equal(e.journal_reference,null);
 const f=fixture();f.documents[0].archived_at='2026-08-12';assert.equal(run(f).entries.find(e=>e.transaction_id==='3').documents.length,0);
});
test('period filter uses transaction DATE, never created_at or client timezone',()=>{
 const f=fixture();f.transactions=[tx(1,'income','1','Product sales',{transaction_date:'2026-08-01',created_at:'2026-07-31T23:00:00Z'}),tx(2,'income','9','Product sales',{transaction_date:'2026-09-01'}),tx(3,'income','1','Product sales',{transaction_date:'2026-08-99'})];
 const r=run(f);assert.equal(r.periods['2026-08'].totals.revenue,'1');assert.equal(r.exceptions.length,1);
});
test('cancelled/rejected/pending linked bills do not silently affect profit',()=>{
 for(const approval_status of ['pending_approval','rejected']){const f=fixture();f.debts[0].approval_status=approval_status;assert.ok(run(f).exceptions.some(e=>e.transaction_id==='3'&&e.reason==='linked_bill_not_approved'));}
});
test('large exact decimals and thousands of entries preserve sums and inputs',()=>{
 const f=fixture();f.transactions=Array.from({length:20000},(_,i)=>tx(i,'income','0.100000000000000001','Product sales'));const before=JSON.stringify(f);
 const r=run(f);assert.equal(r.periods['2026-08'].totals.revenue,'2000.00000000000002');assert.equal(JSON.stringify(f),before);
 assert.equal(exact('99999999999999999999.123456789012345678'),'99999999999999999999.123456789012345678');
});
test('duplicate source ID aborts rather than counting twice',()=>{const f=fixture();f.transactions.push(f.transactions[0]);assert.throws(()=>run(f),/duplicate_transaction_read/);});
test('malformed dates cannot disappear as if they were outside the reporting period',()=>{
 const f=fixture();f.transactions=[tx(1,'income','1','Product sales',{transaction_date:'bad-date'}),tx(2,'income','2','Product sales',{transaction_date:''}),tx(3,'income','3','Product sales',{transaction_date:'2026-02-30'}),tx(4,'income','100','Product sales',{transaction_date:'2026-09-01'})]
 const r=run(f);assert.equal(r.entries.length,0);assert.deepEqual(r.exceptions.map(e=>e.transaction_id),['1','2','3']);assert.ok(r.exceptions.every(e=>e.reason==='missing_transaction_date'))
})
test('legacy bank-import opening source is excluded even without its newer boolean marker',()=>{
 const f=fixture();f.transactions=[tx(1,'income','9999999','Product sales',{source:'bank_import_opening',is_opening_balance:false})]
 const r=run(f);assert.equal(r.periods['2026-08'].totals.revenue,'0');assert.equal(r.excluded[0].reason,'opening_or_correction')
})
test('full refund reversals net to zero; FX/network/bank fees remain exact mapped cash costs',()=>{
 const f=fixture();f.transactions=[tx(1,'income','1.234567890123456789','Product sales'),tx(2,'expense','1.234567890123456789','Product sales'),...['fx_fee','network_fee','bank_fee'].map((type,i)=>tx(i+3,type,'0.000000000000000001','Rent')),tx(8,'fx_transfer_in','999','Product sales'),tx(9,'fx_transfer_out','999','Rent')]
 const r=run(f);assert.equal(r.periods['2026-08'].totals.revenue,'0');assert.equal(r.periods['2026-08'].totals.operating_cost,'0.000000000000000003');assert.equal(r.excluded.length,2)
})
test('invalid filters and unsupported accrual rejected, never fallback',()=>{
 for(const q of [{month:'2026-13'},{month:['2026-08']},{month:'2026-08',currency:['IDR']},{month:'2026-08',compare:'2026-08'},{month:'2026-08',compare:'2024-08'},{month:'2026-08',currency:'idr'},{month:'2026-08',basis:'accrual'}])assert.throws(()=>options(q));
});
