// Fictional businesses only. Never imported into a live database.
const B='b0000000-0000-4000-8000-000000000001',OTHER='b0000000-0000-4000-8000-000000000002';
const cat=(id,name,pnl_group)=>({id,name,pnl_group,business_id:B});
const tx=(id,type,amount,category,extra={})=>({id:String(id),business_id:B,type,amount_original:amount,currency_original:'IDR',transaction_date:'2026-08-10',category,description:'Synthetic '+category,counterparty_name:'Example Co',wallet_id:'bank1',...extra});
function fixture(){return {
 categories:[cat('sales','Product sales','revenue'),cat('direct','Supplies','direct_cost'),cat('rent','Rent','operating_cost'),cat('salary','Salaries','operating_cost'),cat('interest','Interest','interest'),cat('tax','Tax','tax'),cat('other','Other income','other_income'),cat('loan','Owner loan','funding'),cat('equipment','Machines','asset_purchase'),cat('move','Transfer','transfer')],
 transactions:[tx(1,'income','1000.10','Product sales'),tx(2,'expense','200.20','Supplies'),tx(3,'expense','100.30','Rent',{debt_payment_id:'501'}),tx(4,'payroll','80.40','Salaries'),tx(5,'expense','10','Interest'),tx(6,'expense','20','Tax'),tx(7,'income','5','Other income'),tx(8,'expense','25','Product sales',{description:'Synthetic sales refund'}),tx(9,'income','10','Rent',{description:'Synthetic cost refund'}),tx(10,'income','2000','Owner loan'),tx(11,'expense','900','Machines'),tx(12,'income','500','Product sales',{transfer_id:'transfer-1'}),tx(13,'expense','300','Unclassified'),tx(14,'income','99','Product sales',{currency_original:'USD'}),tx(15,'income','999999','Product sales',{business_id:OTHER}),tx(16,'expense','0.10','Rent',{transaction_date:'2026-07-31'}),tx(17,'income','200','Product sales',{transaction_date:null}),tx(18,'income','200','Product sales',{is_training:true})],
 wallets:[{id:'bank1',business_id:B,name:'Synthetic IDR bank'}],
 debts:[{id:'501',business_id:B,type:'payable',original_amount:'100.30',linked_transaction_id:'3',category:'Rent',invoice_number:'SYN-501',status:'paid',approval_status:'approved'},{id:'502',business_id:B,type:'payable',original_amount:'99000',category:'Rent',invoice_number:'SYN-UNPAID',status:'open',approval_status:'approved'}],
 documents:[{id:'doc1',business_id:B,document_number:'SYN-RENT',document_type:'vendor_invoice',review_status:'needs_review'},{id:'foreignDoc',business_id:OTHER,document_number:'SECRET MUST NOT APPEAR',review_status:'confirmed'}],
 txLinks:[{id:'link1',business_id:B,document_id:'foreignDoc',transaction_id:'3'}],debtLinks:[{id:'dl1',business_id:B,document_id:'doc1',debt_id:'501'}],
 bank:[{id:'row3',business_id:B,linked_transaction_id:'3',batch_id:'batch1',review_status:'confirmed',match_status:'linked'}],
 payroll:[{id:'salary1',business_id:B,transaction_id:'4',period_month:'2026-08',status:'paid'},{id:'draft',business_id:B,transaction_id:null,period_month:'2026-08',status:'draft'}],
 assets:[],funding:[],repayments:[],allocations:[]};}
module.exports={B,OTHER,fixture,tx,cat};
