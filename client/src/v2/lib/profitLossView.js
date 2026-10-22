// Presentation over server contributions. No second accounting calculator.
import {csvCell} from './csv.js'
export const GROUPS=['revenue','direct_cost','operating_cost','other_income','interest','tax']
export function exactMoney(value,currency='IDR') {
  if(value==null||! /^-?\d+(\.\d+)?$/.test(String(value)))return '—'
  const [whole,fraction]=String(value).split('.')
  const sign=whole.startsWith('-')?'−':''
  const digits=whole.replace('-','').replace(/\B(?=(\d{3})+(?!\d))/g,',')
  return `${currency==='IDR'?'Rp':currency} ${sign}${digits}${fraction?'.'+fraction:''}`
}
// Only chart geometry/axis ticks are approximate. Actual values remain exact strings.
export function chartMoneyScale(values,currency='IDR') {
  const max=Math.max(0,...values.map(v=>Math.abs(Number(v)||0)))
  const [divisor,suffix]=[[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'K'],[1,'']].find(([n])=>max>=n)||[1,'']
  return {unitLabel:`≈ ${currency} × ${divisor.toLocaleString('en-US')}${suffix?` (${suffix})`:''}`,
    formatTick:v=>(v/divisor).toFixed(6).replace(/\.?0+$/,'').replace(/^-0$/,'0')||'0'}
}
export function difference(a,b){
  if(a==null||b==null)return null
  const n=s=>{const [i,f='']=String(s).split('.');return BigInt(i.replace('-','')+f.padEnd(18,'0'))*(String(s).startsWith('-')?-1n:1n)}
  const d=n(a)-n(b),x=d<0n?-d:d,frac=(x%10n**18n).toString().padStart(18,'0').replace(/0+$/,'')
  return (d<0n?'-':'')+(x/10n**18n).toString()+(frac?'.'+frac:'')
}
export function compareAmounts(a,b){const d=difference(a,b);return d==='0'?0:d.startsWith('-')?-1:1}
export function percentChange(a,b){
 if(a==null||b==null||compareAmounts(b,'0')<=0)return null
 const units=v=>{const [i,f='']=String(v).replace('-','').split('.');return BigInt(i+f.padEnd(18,'0'))*(String(v).startsWith('-')?-1n:1n)}
 const delta=units(a)-units(b),base=units(b),n=(delta<0n?-delta:delta)*100n
 return {direction:delta<0n?'down':delta>0n?'up':'flat',percent:((n+base/2n)/base).toString()}
}
export const validMonth=m=>typeof m==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(m)
const monthIndex=m=>Number(m.slice(0,4))*12+Number(m.slice(5))-1
export function filterError(month,compare,currency){
 if(!validMonth(month)||compare&&(!validMonth(compare)||compare===month||Math.abs(monthIndex(month)-monthIndex(compare))>12))return 'invalidPeriod'
 if(!/^[A-Z][A-Z0-9]{2,9}$/.test(currency))return 'invalidCurrency'
 return null
}
export function reportHistory(month,compare){
 if(!validMonth(month))return []
 const end=monthIndex(month),other=validMonth(compare)?monthIndex(compare):end
 return Array.from({length:12},(_,i)=>end-11+i).filter(n=>n>=Math.max(end,other)-12&&n<=Math.min(end,other)+12).map(n=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`).filter(validMonth)
}
export function periodEvidence(report,months){
 const wanted=new Set(months.filter(Boolean)),inPeriod=e=>wanted.has(e.date?.slice(0,7))
 const entries=report.entries.filter(inPeriod),exceptions=report.exceptions.filter(e=>e.reason==='missing_transaction_date'||!e.date||inPeriod(e)),excluded=report.excluded.filter(inPeriod)
 return {entries,exceptions,excluded,coverage:{included:entries.length,exceptions:exceptions.length,excluded:excluded.length,missing_documents:entries.filter(e=>!e.documents.length).length}}
}
export function sourceLinks(e){
  const links=[{kind:'transaction',href:`/business/transactions?tx=${encodeURIComponent(e.transaction_id)}`}]
  for(const b of e.bills||[])links.push({kind:'bill',label:b.number,href:`/business/${b.type==='receivable'?'receivables':'payables'}/${encodeURIComponent(b.id)}`})
  if(e.payroll?.length)links.push({kind:'payroll',href:'/business/payroll'})
  return links
}
const WEIGHTS={revenue:{revenue:1},direct_cost:{direct_cost:-1},gross:{revenue:1,direct_cost:-1},operating_cost:{operating_cost:-1},ebitda:{revenue:1,direct_cost:-1,operating_cost:-1},other_income:{other_income:1},interest:{interest:-1},tax:{tax:-1},cash_result:{revenue:1,direct_cost:-1,operating_cost:-1,other_income:1,interest:-1,tax:-1},net_profit:{}};
export function metricTotal(report,month,metric){
 const value=report?.periods[month]?.totals[metric];
 return ['direct_cost','operating_cost','interest','tax'].includes(metric)&&value!=null?difference('0',value):value??null;
}
export function metricDetail(report,month,metric){
 const period=report?.periods[month],weights=Object.hasOwn(WEIGHTS,metric)?WEIGHTS[metric]:null;if(!period||!weights)return null;
 const signed=(v,weight)=>weight===-1?difference('0',v):v;
 const entriesByKey=new Map(report.entries.map(e=>[e.key,e]));
 const groups=Object.entries(weights).map(([key,weight])=>({key,total:signed(period.groups[key].total,weight),categories:period.groups[key].categories.map(c=>({...c,total:signed(c.total,weight),entries:c.entry_keys.map(k=>({...entriesByKey.get(k),contribution:signed(entriesByKey.get(k).contribution,weight)}))}))}));
 return {total:metricTotal(report,month,metric),groups};
}
export function reportSeries(report,months){
 return months.map(month=>{const p=report.periods[month],v=p.totals;return {...v,month,direct:v.direct_cost,opex:v.operating_cost,net:v.net_profit,otherIncome:v.other_income,empty:!p.entry_keys.length,margin:null};});
}
export function monthlyReportCsv(report,months){
 const columns=['month','currency','basis','revenue','direct','gross','opex','ebitda','depreciation','otherIncome','interest','tax','cash_result','net']
 const rows=reportSeries(report,months).map(r=>({...r,currency:report.currency,basis:'provisional_cash'}))
 return '\uFEFF'+[columns,...rows.map(r=>columns.map(c=>r[c]))].map(r=>r.map(csvCell).join(',')).join('\r\n')
}
export function expenseBreakdown(report,month,compare){
 const p=report.periods[month],before=report.periods[compare],cats=new Map();
 for(const [period,field]of [[p,'now'],[before,'before']])for(const g of ['direct_cost','operating_cost'])for(const c of period?.groups[g]?.categories||[]){if(!cats.has(c.id))cats.set(c.id,{id:c.id,category:c.name,now:'0',before:'0'});cats.get(c.id)[field]=c.total;}
 return {changes:[...cats.values()].map(c=>({...c,delta:difference(c.now,c.before)}))};
}
export function reportCsv(data,{month=data.month,compare=data.compare,metric=null}={}){
 const cols=['date','currency','contribution','native_amount','group','category','account','counterparty','description','source_type','transaction_id','journal_reference','reconciliation_status','bill_numbers','payroll_periods','document_references','document_review_statuses'];
 const months=[...new Set([month,compare].filter(Boolean))],scope=periodEvidence(data,months)
 const entries=metric?months.flatMap(m=>metricDetail(data,m,metric)?.groups.flatMap(g=>g.categories.flatMap(c=>c.entries))||[]):scope.entries
 const rows=[['PROVISIONAL CASH VIEW — NOT ACCOUNTING PROFIT',month,compare||'',data.currency,metric||'all_cash_groups'],cols,...entries.map(e=>{const row={...e,bill_numbers:e.bills.map(x=>x.number||x.id).join('; '),payroll_periods:e.payroll.map(x=>x.period).join('; '),document_references:e.documents.map(x=>x.number||x.id).join('; '),document_review_statuses:e.documents.map(x=>x.review_status).join('; ')};return cols.map(k=>row[k])}),[],['EXCEPTIONS'],['date','currency','native_amount','reason'],...scope.exceptions.map(e=>[e.date,e.currency,e.native_amount,e.reason]),[],['EXCLUDED MOVEMENTS'],['date','currency','native_amount','reason'],...scope.excluded.map(e=>[e.date,e.currency,e.native_amount,e.reason])];
 return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}
export function downloadReport(data,selection={}){
 if(!data)return;const url=URL.createObjectURL(new Blob([reportCsv(data,selection)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`pnl-cash-estimate-${selection.month||data.month}-${data.currency}${selection.metric?'-'+selection.metric:''}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export const COPY={
 en:{title:'Profit & Loss',sub:'Explore each total through its categories, payments and evidence.',cash:'Cash-based estimate',basis:'Reporting basis',accrual:'Accrual — not yet supported',period:'Month',compare:'Compare with',none:'No comparison',currency:'Currency',note:'This is a provisional view of classified cash movements, not confirmed accounting profit. Unpaid bills and draft payroll are not added. VAT, withholding, inventory and depreciation are not fully separated.',netNote:'Net Profit is unavailable: verified accrual recognition and journal entries are not implemented.',groups:'Confirm category mapping',refresh:'Refresh',export:'Export detail CSV',expand:'Expand all',collapse:'Collapse all',category:'Category / measure',amount:'Amount',previous:'Comparison',change:'Change',revenue:'Revenue',direct_cost:'Direct Costs',gross:'Gross Profit — cash estimate',operating_cost:'Operating Expenses',ebitda:'EBITDA — cash estimate',other_income:'Other income',interest:'Interest paid',tax:'Tax payments — not tax expense',cash_result:'Classified cash result',net_profit:'Net Profit',entries:'Records',empty:'No classified records for this month and currency.',exceptions:'Needs review — excluded from totals',excluded:'Other movements — excluded from P&L',unknown:'Not recorded',missing:'No linked supporting document',journal:'Journal entry',unverified:'Not accountant approved · reconciliation not verified',bank:'Bank review',linked:'Statement linked; reconciliation not confirmed',source:'Open source',documents:'Supporting documents',more:'Show next 50',newTab:'Opens in a new tab; this report keeps its filters.',observed:'Read interval',notSnapshot:'Separate reads; not a locked accounting snapshot.',coverage:'Coverage (selected periods)',included:'included',missingCount:'without linked documents',reviewCount:'exceptions',fx:'Native currency only. Other currencies are listed separately; no exchange-rate estimate is applied.',formula:'Formula',expense:'Cash out',income:'Cash in',count:'records',noEntries:'No records',reason:'Reason',date:'Date',description:'Description',counterparty:'Counterparty',account:'Bank account',type:'Source type',bill:'Bill / invoice',transaction:'Transaction',payroll:'Payroll',review:'Document review',categoryName:'Category',noComparison:'Comparison unavailable',unclassified_or_ambiguous_category:'Category is unconfirmed or ambiguous',missing_transaction_date:'Transaction date is missing',missing_currency:'Currency is missing',invalid_or_inexact_amount:'Amount cannot be read exactly',repayment_split_not_verified:'Principal / interest split needs review',negative_magnitude_needs_review:'Negative amount needs review',linked_bill_not_approved:'Linked bill is unapproved or cancelled',unsupported_transaction_type:'Transaction type needs review',unsupported_category_group:'Category group is unsupported',own_account_transfer:'Transfer between own accounts',financing:'Financing / capital',capital_purchase:'Capital purchase',other_currency:'Other currency',opening_or_correction:'Opening balance / correction',asset_purchase:'Asset purchase',funding:'Funding',transfer:'Transfer'},
 ru:{title:'Прибыли и убытки',sub:'Каждая сумма раскрывается до категорий, операций и документов.',cash:'Оценка по движениям денег',basis:'Основа отчёта',accrual:'Метод начисления пока недоступен',period:'Месяц',compare:'Сравнить с',none:'Без сравнения',currency:'Валюта',note:'Это предварительная оценка классифицированных движений денег, а не подтверждённая бухгалтерская прибыль. Неоплаченные счета и черновики зарплат не добавляются. НДС, удержания, запасы и амортизация разделены не полностью.',netNote:'Чистая прибыль недоступна: подтверждённое признание доходов и расходов и журнал проводок ещё не реализованы.',groups:'Подтвердить категории',refresh:'Обновить',export:'Экспорт детализации CSV',expand:'Раскрыть всё',collapse:'Свернуть всё',category:'Категория / показатель',amount:'Сумма',previous:'Сравнение',change:'Изменение',revenue:'Выручка',direct_cost:'Прямые затраты',gross:'Валовая прибыль — оценка по оплатам',operating_cost:'Операционные расходы',ebitda:'EBITDA — оценка по оплатам',other_income:'Прочие поступления',interest:'Уплаченные проценты',tax:'Налоговые платежи — не налоговый расход',cash_result:'Результат классифицированных оплат',net_profit:'Чистая прибыль',entries:'Записи',empty:'За выбранный месяц в этой валюте нет классифицированных операций.',exceptions:'Нужно проверить — не включено в итоги',excluded:'Другие движения — вне P&L',unknown:'Не указано',missing:'Нет связанного подтверждающего документа',journal:'Проводка',unverified:'Нет подтверждения бухгалтера · сверка не подтверждена',bank:'Проверка банковской строки',linked:'Связано с выпиской; сверка не подтверждена',source:'Открыть источник',documents:'Документы',more:'Показать следующие 50',newTab:'Откроется в новой вкладке; фильтры отчёта сохранятся.',observed:'Интервал чтения',notSnapshot:'Данные прочитаны отдельными запросами, без фиксации бухгалтерского снимка.',coverage:'Покрытие выбранных периодов',included:'включено',missingCount:'без связанных документов',reviewCount:'исключений',fx:'Только исходная валюта. Другие валюты показаны отдельно; пересчёт курса не применяется.',formula:'Формула',expense:'Списание',income:'Поступление',count:'записей',noEntries:'Нет записей',reason:'Причина',date:'Дата',description:'Описание',counterparty:'Контрагент',account:'Счёт',type:'Источник',bill:'Счёт / инвойс',transaction:'Операция',payroll:'Зарплата',review:'Проверка документа',categoryName:'Категория',noComparison:'Сравнение недоступно',unclassified_or_ambiguous_category:'Категория не подтверждена или неоднозначна',missing_transaction_date:'Не указана дата операции',missing_currency:'Не указана валюта',invalid_or_inexact_amount:'Сумма не прочитана точно',repayment_split_not_verified:'Нужно разделить основной долг и проценты',negative_magnitude_needs_review:'Отрицательная сумма требует проверки',linked_bill_not_approved:'Связанный счёт не согласован или отменён',unsupported_transaction_type:'Тип операции требует проверки',unsupported_category_group:'Группа категории не поддерживается',own_account_transfer:'Перевод между своими счетами',financing:'Финансирование / капитал',capital_purchase:'Покупка основного средства',other_currency:'Другая валюта',opening_or_correction:'Начальный остаток / корректировка',asset_purchase:'Основное средство',funding:'Финансирование',transfer:'Перевод'},
 id:{title:'Laba & Rugi',sub:'Telusuri jumlah ke kategori, transaksi, dan dokumen.',cash:'Estimasi berbasis kas',basis:'Dasar laporan',accrual:'Akrual belum didukung',period:'Bulan',compare:'Bandingkan',none:'Tanpa perbandingan',currency:'Mata uang',note:'Estimasi arus kas terklasifikasi, bukan laba akuntansi terkonfirmasi. Tagihan belum dibayar dan draf gaji tidak ditambahkan. PPN, pemotongan, persediaan dan penyusutan belum dipisahkan sepenuhnya.',netNote:'Laba bersih belum tersedia: pengakuan akrual dan jurnal terverifikasi belum diterapkan.',groups:'Konfirmasi kategori',refresh:'Muat ulang',export:'Ekspor rincian CSV',expand:'Buka semua',collapse:'Tutup semua',category:'Kategori / ukuran',amount:'Jumlah',previous:'Perbandingan',change:'Perubahan',revenue:'Pendapatan',direct_cost:'Biaya langsung',gross:'Laba kotor — estimasi kas',operating_cost:'Beban operasional',ebitda:'EBITDA — estimasi kas',other_income:'Penerimaan lainnya',interest:'Bunga dibayar',tax:'Pembayaran pajak — bukan beban pajak',cash_result:'Hasil kas terklasifikasi',net_profit:'Laba bersih',entries:'Catatan',empty:'Tidak ada transaksi terklasifikasi untuk periode dan mata uang ini.',exceptions:'Perlu ditinjau — di luar total',excluded:'Arus lain — di luar P&L',unknown:'Belum dicatat',missing:'Tidak ada dokumen pendukung tertaut',journal:'Jurnal',unverified:'Belum disetujui akuntan · rekonsiliasi belum terkonfirmasi',bank:'Tinjauan bank',linked:'Tertaut rekening koran; belum direkonsiliasi',source:'Buka sumber',documents:'Dokumen pendukung',more:'Tampilkan 50 berikutnya',newTab:'Dibuka di tab baru; filter laporan tetap tersimpan.',observed:'Interval pembacaan',notSnapshot:'Pembacaan terpisah, bukan snapshot akuntansi terkunci.',coverage:'Cakupan periode terpilih',included:'termasuk',missingCount:'tanpa dokumen tertaut',reviewCount:'pengecualian',fx:'Mata uang asli saja. Mata uang lain ditampilkan terpisah tanpa estimasi kurs.',formula:'Rumus',expense:'Kas keluar',income:'Kas masuk',count:'catatan',noEntries:'Tidak ada catatan',reason:'Alasan',date:'Tanggal',description:'Deskripsi',counterparty:'Pihak lawan',account:'Rekening',type:'Sumber',bill:'Tagihan / faktur',transaction:'Transaksi',payroll:'Penggajian',review:'Tinjauan dokumen',categoryName:'Kategori'}
}
const DETAIL_COPY={
 en:{technical:'Description, evidence and audit details',method:'Method and limitations',moneyFormat:'Full amounts: comma groups thousands; dot marks decimals. Only chart axes are scaled (≈).'},
 ru:{technical:'Описание, основания и сведения о проверке',method:'Метод и ограничения',moneyFormat:'Полные суммы: запятая разделяет тысячи, точка — дробную часть. Масштабируются только оси графиков (≈).'},
 id:{technical:'Deskripsi, bukti dan rincian audit',method:'Metode dan batasan',moneyFormat:'Jumlah penuh: koma untuk ribuan, titik untuk desimal. Hanya sumbu grafik yang diskalakan (≈).'}
}
const CASH_METHOD={
 en:[
  'Classified cash receipts and payments count by transaction date. Unpaid bills and draft payroll do not add profit or costs.',
  'Only confirmed company category mappings count. Missing or ambiguous categories stay outside totals as exceptions.',
  'Refunds reverse their mapped group. Transfers, financing, opening corrections and identified capital purchases stay outside this estimate.',
  'Amounts stay in the selected native currency, without exchange-rate conversion. CSV preserves full recorded precision.',
  'Tax payments are classified cash, not accrued tax expense. VAT and withholding are not fully separated; no depreciation or journal is invented.'
 ],
 ru:[
  'Классифицированные поступления и списания учитываются по дате операции. Неоплаченные счета и черновики зарплаты не добавляются в итоги.',
  'Учитываются только подтверждённые группы категорий компании. Неоднозначные и отсутствующие категории остаются в исключениях.',
  'Возвраты уменьшают свою группу. Переводы, финансирование, корректировки остатков и выявленные капитальные покупки исключены из оценки.',
  'Суммы показаны в выбранной исходной валюте без пересчёта курса. CSV сохраняет полную записанную точность.',
  'Налоговые платежи отражают движение денег, а не начисленный налоговый расход. НДС и удержания разделены не полностью; амортизация и проводки не создаются.'
 ],
 id:[
  'Penerimaan dan pembayaran kas terklasifikasi dihitung menurut tanggal transaksi. Tagihan belum dibayar dan draf gaji tidak ditambahkan.',
  'Hanya pemetaan kategori perusahaan yang dikonfirmasi dihitung. Kategori kosong atau ambigu menjadi pengecualian di luar total.',
  'Pengembalian membalik kelompok terkait. Transfer, pendanaan, koreksi saldo awal dan pembelian modal teridentifikasi dikecualikan.',
  'Jumlah tetap dalam mata uang asli terpilih tanpa konversi kurs. CSV mempertahankan seluruh presisi tercatat.',
  'Pembayaran pajak adalah kas terklasifikasi, bukan beban pajak akrual. PPN dan pemotongan belum dipisahkan sepenuhnya; penyusutan dan jurnal tidak dibuat.'
 ]
}
const COMPLETION_COPY={
 en:{invalidReport:'The report response does not match the selected company, period or currency. Reload the report.',undated:'Records with missing or invalid dates cannot be assigned to a month; they remain visible as exceptions and are excluded from totals.',invalidPeriod:'Choose a valid month and a different comparison within 12 months.',invalidCurrency:'Choose a valid native currency code.',invalidMetric:'This report detail is unavailable.',resetFilters:'Reset report filters',backReport:'Back to report',missing_transaction_date:'Transaction date is missing or invalid',mixed_asset_allocation:'Mixed capital and operating allocation needs review',cashResult:'Classified cash result — not Net Profit',period:'Month'},
 ru:{invalidReport:'????? ?????? ?? ????????????? ????????? ????????, ??????? ??? ??????. ???????? ?????.',undated:'?????? ??? ?????????? ???? ?????? ??????? ? ??????: ??? ???????? ? ??????????? ? ?? ???????? ? ?????.',invalidPeriod:'Выберите корректный месяц и другой период сравнения в пределах 12 месяцев.',invalidCurrency:'Выберите корректный код исходной валюты.',invalidMetric:'Эта детализация отчёта недоступна.',resetFilters:'Сбросить фильтры отчёта',backReport:'К отчёту',missing_transaction_date:'Дата операции отсутствует или некорректна',mixed_asset_allocation:'Нужно разделить капитальную и операционную части',cashResult:'Результат по оплатам — не чистая прибыль',period:'Месяц'},
 id:{invalidReport:'Respons laporan tidak sesuai dengan perusahaan, periode, atau mata uang terpilih. Muat ulang laporan.',undated:'Catatan tanpa tanggal valid tidak dapat ditetapkan ke bulan; tetap ditampilkan sebagai pengecualian di luar total.',invalidPeriod:'Pilih bulan yang valid dan periode pembanding berbeda dalam 12 bulan.',invalidCurrency:'Pilih kode mata uang asli yang valid.',invalidMetric:'Rincian laporan ini tidak tersedia.',resetFilters:'Atur ulang filter laporan',backReport:'Kembali ke laporan',missing_transaction_date:'Tanggal transaksi kosong atau tidak valid',mixed_asset_allocation:'Alokasi modal dan operasional perlu ditinjau',cashResult:'Hasil kas terklasifikasi — bukan laba bersih',period:'Bulan'}
}
export function copy(lang){const c={...COPY.en,...COPY[lang],...DETAIL_COPY.en,...DETAIL_COPY[lang],...COMPLETION_COPY.en,...COMPLETION_COPY[lang]};return {...c,cashHow:CASH_METHOD[lang]||CASH_METHOD.en,bank_transaction:c.account,transaction:c.transaction,payroll_payment:c.payroll,needs_review:c.exceptions.split(' — ')[0],confirmed:lang==='ru'?'Подтверждено':lang==='id'?'Dikonfirmasi':'Confirmed'}}
