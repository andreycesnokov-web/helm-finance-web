import { useState } from 'react'
import { Icon } from '../shell/ui'
import './OnboardingTourPreview.css'

const META = [
  ['pulse','overview','pulse','bars'],['radar','overview','radar','risk'],['aiCfo','overview','cfo','chat'],
  ['accountant','finance','acct','score'],['transactions','finance','list','table'],['wallets','finance','wallet','cards'],
  ['invoices','finance','doc','table'],['receivables','finance','down','bars'],['payables','finance','up','flow'],
  ['funding','capital','fund','cards'],['bankImport','connections','bank','flow'],['incoming','connections','arrowDown','table'],
  ['connections','connections','link','cards'],['intercompany','operations','transfer','cards'],['payroll','operations','users','flow'],
  ['approvals','operations','check','table'],['team','operations','team','cards'],['documents','workspace','doc','cards'],
  ['settings','workspace','cog','settings'],['support','workspace','book','chat'],
].map(([key,group,icon,layout])=>({key,group,icon,layout}))

const COPY = {
  en: [
    ['Pulse','Your financial command center'],['Radar','See risk before it becomes urgent'],['AI CFO','Ask strategic finance questions'],
    ['AI Accountant','Prepare the accounting foundation'],['Transactions','Review every money movement'],['Accounts / Wallets','Keep every balance in view'],
    ['Invoices','Create and track invoices'],['Receivables','Collect money on time'],['Payables','Control upcoming obligations'],
    ['Funding & Investors','Track company capital'],['Bank Import','Bring bank activity into the workspace'],['Incoming Payments','Monitor money received'],
    ['Payment Connections','Connect payment providers'],['Intercompany','Keep related-company activity clear'],['Payroll','Prepare payroll with context'],
    ['Approvals','Move decisions forward'],['Team','Set roles and access'],['Documents','Build a reliable evidence trail'],
    ['Settings','Configure the workspace'],['Support Center','Get help without leaving the product'],
  ],
  id: [
    ['Pulse','Pusat kendali keuangan Anda'],['Radar','Lihat risiko sebelum menjadi mendesak'],['AI CFO','Ajukan pertanyaan keuangan strategis'],
    ['AI Accountant','Siapkan fondasi akuntansi'],['Transaksi','Tinjau setiap pergerakan uang'],['Akun / Wallet','Pantau setiap saldo'],
    ['Invoice','Buat dan lacak invoice'],['Piutang','Tagih pembayaran tepat waktu'],['Utang','Kendalikan kewajiban mendatang'],
    ['Pendanaan & Investor','Pantau modal perusahaan'],['Impor Bank','Masukkan aktivitas bank ke ruang kerja'],['Pembayaran Masuk','Pantau uang yang diterima'],
    ['Koneksi Pembayaran','Hubungkan penyedia pembayaran'],['Antarperusahaan','Jaga aktivitas antarperusahaan tetap jelas'],['Payroll','Siapkan payroll dengan konteks'],
    ['Persetujuan','Percepat pengambilan keputusan'],['Tim','Atur peran dan akses'],['Dokumen','Bangun jejak bukti yang andal'],
    ['Pengaturan','Konfigurasikan ruang kerja'],['Pusat Dukungan','Dapatkan bantuan tanpa keluar dari produk'],
  ],
  ru: [
    ['Pulse','\u0424\u0438\u043d\u0430\u043d\u0441\u043e\u0432\u044b\u0439 \u043a\u043e\u043c\u0430\u043d\u0434\u043d\u044b\u0439 \u0446\u0435\u043d\u0442\u0440'],
    ['\u0420\u0430\u0434\u0430\u0440','\u0423\u0432\u0438\u0434\u0435\u0442\u044c \u0440\u0438\u0441\u043a \u0434\u043e \u0442\u043e\u0433\u043e, \u043a\u0430\u043a \u043e\u043d \u0441\u0442\u0430\u043d\u0435\u0442 \u043a\u0440\u0438\u0442\u0438\u0447\u043d\u044b\u043c'],
    ['AI CFO','\u0417\u0430\u0434\u0430\u0432\u0430\u0439\u0442\u0435 \u0441\u0442\u0440\u0430\u0442\u0435\u0433\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u0444\u0438\u043d\u0430\u043d\u0441\u043e\u0432\u044b\u0435 \u0432\u043e\u043f\u0440\u043e\u0441\u044b'],
    ['AI Accountant','\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u044c\u0442\u0435 \u043e\u0441\u043d\u043e\u0432\u0443 \u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0441\u043a\u043e\u0433\u043e \u0443\u0447\u0435\u0442\u0430'],
    ['\u0422\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0438','\u041f\u0440\u043e\u0432\u0435\u0440\u044f\u0439\u0442\u0435 \u043a\u0430\u0436\u0434\u043e\u0435 \u0434\u0432\u0438\u0436\u0435\u043d\u0438\u0435 \u0434\u0435\u043d\u0435\u0433'],
    ['\u0421\u0447\u0435\u0442\u0430 \u0438 \u043a\u043e\u0448\u0435\u043b\u044c\u043a\u0438','\u041a\u043e\u043d\u0442\u0440\u043e\u043b\u0438\u0440\u0443\u0439\u0442\u0435 \u043a\u0430\u0436\u0434\u044b\u0439 \u043e\u0441\u0442\u0430\u0442\u043e\u043a'],
    ['\u0421\u0447\u0435\u0442\u0430 \u043a\u043b\u0438\u0435\u043d\u0442\u0430\u043c','\u0421\u043e\u0437\u0434\u0430\u0432\u0430\u0439\u0442\u0435 \u0438 \u043e\u0442\u0441\u043b\u0435\u0436\u0438\u0432\u0430\u0439\u0442\u0435 \u0441\u0447\u0435\u0442\u0430'],
    ['\u0414\u0435\u0431\u0438\u0442\u043e\u0440\u0441\u043a\u0430\u044f \u0437\u0430\u0434\u043e\u043b\u0436\u0435\u043d\u043d\u043e\u0441\u0442\u044c','\u041f\u043e\u043b\u0443\u0447\u0430\u0439\u0442\u0435 \u043e\u043f\u043b\u0430\u0442\u0443 \u0432\u043e\u0432\u0440\u0435\u043c\u044f'],
    ['\u041a\u0440\u0435\u0434\u0438\u0442\u043e\u0440\u0441\u043a\u0430\u044f \u0437\u0430\u0434\u043e\u043b\u0436\u0435\u043d\u043d\u043e\u0441\u0442\u044c','\u041a\u043e\u043d\u0442\u0440\u043e\u043b\u0438\u0440\u0443\u0439\u0442\u0435 \u043f\u0440\u0435\u0434\u0441\u0442\u043e\u044f\u0449\u0438\u0435 \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432\u0430'],
    ['\u0424\u0438\u043d\u0430\u043d\u0441\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0438 \u0438\u043d\u0432\u0435\u0441\u0442\u043e\u0440\u044b','\u041e\u0442\u0441\u043b\u0435\u0436\u0438\u0432\u0430\u0439\u0442\u0435 \u043a\u0430\u043f\u0438\u0442\u0430\u043b \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u0438'],
    ['\u0418\u043c\u043f\u043e\u0440\u0442 \u0431\u0430\u043d\u043a\u0430','\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0431\u0430\u043d\u043a\u043e\u0432\u0441\u043a\u0438\u0435 \u043e\u043f\u0435\u0440\u0430\u0446\u0438\u0438'],
    ['\u0412\u0445\u043e\u0434\u044f\u0449\u0438\u0435 \u043f\u043b\u0430\u0442\u0435\u0436\u0438','\u041a\u043e\u043d\u0442\u0440\u043e\u043b\u0438\u0440\u0443\u0439\u0442\u0435 \u043f\u043e\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u044f'],
    ['\u041f\u043b\u0430\u0442\u0435\u0436\u043d\u044b\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f','\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u0435 \u043f\u043b\u0430\u0442\u0435\u0436\u043d\u044b\u0445 \u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440\u043e\u0432'],
    ['\u041c\u0435\u0436\u0434\u0443 \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u044f\u043c\u0438','\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0439\u0442\u0435 \u043f\u0440\u043e\u0437\u0440\u0430\u0447\u043d\u043e\u0441\u0442\u044c \u0440\u0430\u0441\u0447\u0435\u0442\u043e\u0432 \u043c\u0435\u0436\u0434\u0443 \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u044f\u043c\u0438'],
    ['\u0417\u0430\u0440\u043f\u043b\u0430\u0442\u0430','\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u044c\u0442\u0435 \u0437\u0430\u0440\u043f\u043b\u0430\u0442\u043d\u044b\u0439 \u0446\u0438\u043a\u043b'],
    ['\u0421\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u0438\u044f','\u0423\u0441\u043a\u043e\u0440\u044c\u0442\u0435 \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u0438\u0435 \u0440\u0435\u0448\u0435\u043d\u0438\u0439'],
    ['\u041a\u043e\u043c\u0430\u043d\u0434\u0430','\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u0442\u0435 \u0440\u043e\u043b\u0438 \u0438 \u0434\u043e\u0441\u0442\u0443\u043f'],
    ['\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u044b','\u0421\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u043d\u0430\u0434\u0435\u0436\u043d\u044b\u0439 \u0430\u0440\u0445\u0438\u0432 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u043e\u0432'],
    ['\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438','\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u0442\u0435 \u0440\u0430\u0431\u043e\u0447\u0435\u0435 \u043f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u0441\u0442\u0432\u043e'],
    ['\u0426\u0435\u043d\u0442\u0440 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0438','\u041f\u043e\u043b\u0443\u0447\u0430\u0439\u0442\u0435 \u043f\u043e\u043c\u043e\u0449\u044c, \u043d\u0435 \u0432\u044b\u0445\u043e\u0434\u044f \u0438\u0437 \u043f\u0440\u043e\u0434\u0443\u043a\u0442\u0430'],
  ],
}

const UI = {
  en:{tour:'Product tour',guide:'Guide',inside:'Inside page',explore:'Explore page',back:'Back',backGuide:'Back to guide',skip:'Skip tour',next:'Next page',finish:'Open dashboard',newAction:'New action',workspace:'Company workspace',owner:'Workspace owner',current:'Current position',attention:'Needs attention',updated:'Last updated',healthy:'Healthy',priority:'Prioritized for today',time:'Workspace time',live:'API',pageInside:'What is inside this page',detail:'Record details',hint:'Select a row to see its details',record:'Record',amount:'Amount or context',status:'Status',responsible:'Admin',team:'Finance team',now:'Updated now',open:'Open record',ready:'Ready',review:'Review',connected:'Connected',overdue:'Overdue',pending:'Pending',matched:'Matched',active:'Active',configured:'Configured',uploaded:'Uploaded',groups:{overview:'Overview',finance:'Finance',capital:'Capital',connections:'Connections',operations:'Operations',workspace:'Workspace'},body:(label)=>'On the '+label+' page you can inspect the key data, statuses, and available actions.'},
  id:{tour:'Tur produk',guide:'Panduan',inside:'Di dalam halaman',explore:'Buka halaman',back:'Kembali',backGuide:'Kembali ke panduan',skip:'Lewati tur',next:'Halaman berikutnya',finish:'Buka dashboard',newAction:'Tindakan baru',workspace:'Ruang kerja perusahaan',owner:'Pemilik ruang kerja',current:'Posisi saat ini',attention:'Perlu perhatian',updated:'Terakhir diperbarui',healthy:'Sehat',priority:'Diprioritaskan hari ini',time:'Waktu ruang kerja',live:'Aktif',pageInside:'Isi halaman ini',detail:'Detail catatan',hint:'Pilih baris untuk melihat detail',record:'Catatan',amount:'Jumlah atau konteks',status:'Status',responsible:'Penanggung jawab',team:'Tim keuangan',now:'Baru diperbarui',open:'Buka catatan',ready:'Siap',review:'Tinjau',connected:'Terhubung',overdue:'Terlambat',pending:'Menunggu',matched:'Cocok',active:'Aktif',configured:'Dikonfigurasi',uploaded:'Diunggah',groups:{overview:'Ringkasan',finance:'Keuangan',capital:'Modal',connections:'Koneksi',operations:'Operasional',workspace:'Ruang kerja'},body:(label)=>'Di halaman '+label+', Anda dapat melihat data utama, status, dan tindakan yang tersedia.'},
  ru:{tour:'\u0422\u0443\u0440 \u043f\u043e \u043f\u0440\u043e\u0434\u0443\u043a\u0442\u0443',guide:'\u041e\u0431\u0437\u043e\u0440',inside:'\u0412\u043d\u0443\u0442\u0440\u0438 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b',explore:'\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443',back:'\u041d\u0430\u0437\u0430\u0434',backGuide:'\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u043a \u043f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0435',skip:'\u041f\u0440\u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0442\u0443\u0440',next:'\u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0430\u044f \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430',finish:'\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0433\u043b\u0430\u0432\u043d\u044b\u0439 \u044d\u043a\u0440\u0430\u043d',newAction:'\u041d\u043e\u0432\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435',workspace:'\u0420\u0430\u0431\u043e\u0447\u0435\u0435 \u043f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u0441\u0442\u0432\u043e \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u0438',owner:'\u0412\u043b\u0430\u0434\u0435\u043b\u0435\u0446 \u043f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u0441\u0442\u0432\u0430',current:'\u0422\u0435\u043a\u0443\u0449\u0430\u044f \u043f\u043e\u0437\u0438\u0446\u0438\u044f',attention:'\u0422\u0440\u0435\u0431\u0443\u0435\u0442 \u0432\u043d\u0438\u043c\u0430\u043d\u0438\u044f',updated:'\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0435 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435',healthy:'\u0421\u0442\u0430\u0431\u0438\u043b\u044c\u043d\u043e',priority:'\u0412 \u043f\u0440\u0438\u043e\u0440\u0438\u0442\u0435\u0442\u0435 \u0441\u0435\u0433\u043e\u0434\u043d\u044f',time:'\u0412\u0440\u0435\u043c\u044f \u043f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u0441\u0442\u0432\u0430',live:'\u0410\u043a\u0442\u0443\u0430\u043b\u044c\u043d\u043e',pageInside:'\u0427\u0442\u043e \u043d\u0430\u0445\u043e\u0434\u0438\u0442\u0441\u044f \u0432\u043d\u0443\u0442\u0440\u0438',detail:'\u0414\u0435\u0442\u0430\u043b\u0438 \u0437\u0430\u043f\u0438\u0441\u0438',hint:'\u041d\u0430\u0436\u043c\u0438\u0442\u0435 \u043d\u0430 \u0441\u0442\u0440\u043e\u043a\u0443, \u0447\u0442\u043e\u0431\u044b \u043f\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0434\u0435\u0442\u0430\u043b\u0438',record:'\u0417\u0430\u043f\u0438\u0441\u044c',amount:'\u0421\u0443\u043c\u043c\u0430 \u0438\u043b\u0438 \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442',status:'\u0421\u0442\u0430\u0442\u0443\u0441',responsible:'\u041e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0439',team:'\u0424\u0438\u043d\u0430\u043d\u0441\u043e\u0432\u0430\u044f \u043a\u043e\u043c\u0430\u043d\u0434\u0430',now:'\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u043e \u0441\u0435\u0439\u0447\u0430\u0441',open:'\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0437\u0430\u043f\u0438\u0441\u044c',ready:'\u0413\u043e\u0442\u043e\u0432\u043e',review:'\u041f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c',connected:'\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u043e',overdue:'\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u043e',pending:'\u041e\u0436\u0438\u0434\u0430\u0435\u0442',matched:'\u0421\u043e\u043f\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u043e',active:'\u0410\u043a\u0442\u0438\u0432\u043d\u043e',configured:'\u041d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u043e',uploaded:'\u0417\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u043e',groups:{overview:'\u041e\u0431\u0437\u043e\u0440',finance:'\u0424\u0438\u043d\u0430\u043d\u0441\u044b',capital:'\u041a\u0430\u043f\u0438\u0442\u0430\u043b',connections:'\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f',operations:'\u041e\u043f\u0435\u0440\u0430\u0446\u0438\u0438',workspace:'\u041f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u0441\u0442\u0432\u043e'},body:(label)=>'\u041d\u0430 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0435 \u00ab'+label+'\u00bb \u043f\u043e\u043a\u0430\u0437\u0430\u043d\u044b \u043a\u043b\u044e\u0447\u0435\u0432\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435, \u0441\u0442\u0430\u0442\u0443\u0441\u044b \u0438 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f.'},
}

const DATA = {
pulse:['IDR 825.4M','3','09:42','8-week cash forecast','Supplier approvals','IDR 825.4M','2','ready','review'],
radar:['2','4','09:40','Cash runway risk','Overdue exposure','31','IDR 46.2M','review','overdue'],
aiCfo:['4','1','09:38','Cash scenario','Board summary','Base','PDF','ready','configured'],
accountant:['82%','4','09:36','Company tax profile','Source documents','PKP / NPWP','7','configured','review'],
transactions:['128','6','09:34','BCA payment','Xendit receipt','- IDR 24.0M','+ IDR 58.4M','review','matched'],
wallets:['IDR 825.4M','2','09:32','Main operating account','Payment balance','IDR 530.2M','IDR 84.5M','connected','active'],
invoices:['18','3','09:30','INV-2026-081','INV-2026-082','IDR 48.0M','IDR 16.5M','active','overdue'],
receivables:['IDR 214.0M','5','09:28','PT Nusantara Retail','CV Bali Supply','IDR 48.0M','IDR 16.5M','review','overdue'],
payables:['IDR 96.8M','4','09:26','Cloud subscription','Office supplier','IDR 12.0M','IDR 8.4M','pending','ready'],
funding:['IDR 4.2B','2','09:24','Seed round 2025','Founder loan','IDR 3.5B','IDR 700M','active','ready'],
bankImport:['126','8','09:22','BCA_August_2026.csv','Unmatched rows','118 / 126','8 / 126','matched','review'],
incoming:['IDR 134.5M','3','09:20','Xendit settlement','Bank transfer','IDR 58.4M','IDR 21.0M','matched','review'],
connections:['2','1','09:18','Xendit','Midtrans','API','Test API','connected','configured'],
intercompany:['IDR 72.0M','2','09:16','Helm Care Pay -> Indonesia','Intercompany clearing','IDR 42.0M','IDR 30.0M','review','matched'],
payroll:['18','2','09:14','August payroll','BPJS contribution','IDR 126.0M','IDR 18.2M','ready','pending'],
approvals:['4','2','09:12','Supplier payment','Payroll run','IDR 24.0M','IDR 126.0M','pending','review'],
team:['6','1','09:10','Andrey C. - Owner','Maya S. - Accountant','Admin','Finance','active','active'],
documents:['42','4','09:08','NPWP_Aruna.pdf','Invoice_July.pdf','6','IDR 48.0M','uploaded','review'],
settings:['12','1','09:06','Reporting currency','Financial year start','IDR','01','configured','configured'],
support:['AI','0','09:04','Connect Xendit','AI Accountant setup','5','8','ready','ready'],
}

function I({name,size=18}){const C=Icon[name]||Icon.dot;return <C width={size} height={size} aria-hidden="true"/>}
function Btn({children,onClick,kind='primary',disabled,icon}){return <button className={'op2-btn '+kind} onClick={onClick} disabled={disabled}>{icon&&<I name={icon} size={15}/>}<span>{children}</span></button>}

const ROLE_PATHS = {
  owner: ['pulse','radar','aiCfo','accountant','transactions','wallets','invoices','receivables','payables','funding','connections','intercompany','payroll','approvals','team','documents','settings','support'],
  cfo: ['pulse','radar','aiCfo','transactions','wallets','receivables','payables','funding','incoming','intercompany','payroll','approvals','documents','support'],
  accountant: ['pulse','accountant','transactions','wallets','invoices','receivables','payables','bankImport','incoming','payroll','documents','settings','support'],
}

const TOUR_WORDS = {
  en: { roles:{owner:'Owner / Founder',cfo:'CFO / Finance lead',accountant:'Accountant'}, modules:'modules', rolePath:'Role path', save:'Save & exit', sectionComplete:'Section complete', sectionBody:'You can return to this section later. Your progress is saved.', continueSection:'Continue to next section', finishTour:'Finish tour', reviewSection:'Review this page', completed:'Completed', notInPath:'Not included in this role path', recordPage:'Record workspace', backPage:'Back to module', activity:'Activity', evidence:'Evidence', nextActions:'Next actions', timeline:['Created in workspace','Reviewed by finance','Ready for the next action'], accountantTitle:'AI Accountant company setup', accountantIntro:'Complete the stable company context AI Accountant needs, independent of page layout.', readiness:'Accounting readiness', openSetup:'Open company setup', tabs:['Company','Tax & compliance','Payroll','Documents','Readiness'], complete:'Complete', needsWork:'Needs input', fields:[['Legal entity type','PT (Perseroan Terbatas)'],['Country','Indonesia'],['NIB','9120304050607'],['NPWP','Not added'],['PKP status','Not registered'],['KBLI','62019'],['Tax scheme','Standard corporate income tax'],['Employees','18'],['Payroll active','Yes'],['Company documents','7 uploaded']] },
  id: { roles:{owner:'Pemilik / Pendiri',cfo:'CFO / Pimpinan keuangan',accountant:'Akuntan'}, modules:'modul', rolePath:'Jalur peran', save:'Simpan & keluar', sectionComplete:'Bagian selesai', sectionBody:'Anda dapat kembali ke bagian ini nanti. Progres sudah disimpan.', continueSection:'Lanjut ke bagian berikutnya', finishTour:'Selesaikan tur', reviewSection:'Tinjau halaman ini', completed:'Selesai', notInPath:'Tidak termasuk dalam jalur peran ini', recordPage:'Ruang kerja catatan', backPage:'Kembali ke modul', activity:'Aktivitas', evidence:'Bukti', nextActions:'Tindakan berikutnya', timeline:['Dibuat di ruang kerja','Ditinjau oleh tim keuangan','Siap untuk tindakan berikutnya'], accountantTitle:'Pengaturan perusahaan AI Accountant', accountantIntro:'Lengkapi konteks perusahaan stabil yang dibutuhkan AI Accountant, terlepas dari tata letak halaman.', readiness:'Kesiapan akuntansi', openSetup:'Buka pengaturan perusahaan', tabs:['Perusahaan','Pajak & kepatuhan','Payroll','Dokumen','Kesiapan'], complete:'Selesai', needsWork:'Perlu dilengkapi', fields:[['Jenis badan hukum','PT (Perseroan Terbatas)'],['Negara','Indonesia'],['NIB','9120304050607'],['NPWP','Belum ditambahkan'],['Status PKP','Belum terdaftar'],['KBLI','62019'],['Skema pajak','Pajak penghasilan badan standar'],['Karyawan','18'],['Payroll aktif','Ya'],['Dokumen perusahaan','7 diunggah']] },
  ru: { roles:{owner:'Владелец / Основатель',cfo:'CFO / Финансовый руководитель',accountant:'Бухгалтер'}, modules:'модулей', rolePath:'Маршрут роли', save:'Сохранить и выйти', sectionComplete:'Раздел завершён', sectionBody:'К этому разделу можно вернуться позже. Прогресс сохранён.', continueSection:'Перейти к следующему разделу', finishTour:'Завершить тур', reviewSection:'Изучить эту страницу', completed:'Завершено', notInPath:'Не входит в маршрут этой роли', recordPage:'Рабочая область записи', backPage:'Назад к модулю', activity:'Активность', evidence:'Документы', nextActions:'Следующие действия', timeline:['Создано в пространстве','Проверено финансовой командой','Готово к следующему действию'], accountantTitle:'Настройка компании для AI Accountant', accountantIntro:'Заполните устойчивый контекст компании, который нужен AI Accountant независимо от дизайна страницы.', readiness:'Готовность учёта', openSetup:'Открыть настройку компании', tabs:['Компания','Налоги и требования','Зарплата','Документы','Готовность'], complete:'Готово', needsWork:'Нужно заполнить', fields:[['Юридическая форма','PT (Perseroan Terbatas)'],['Страна','Indonesia'],['NIB','9120304050607'],['NPWP','Не добавлен'],['Статус PKP','Не зарегистрирован'],['KBLI','62019'],['Налоговая схема','Стандартный налог на прибыль'],['Сотрудники','18'],['Расчёт зарплаты','Активен'],['Документы компании','Загружено 7']] },
}

function copyFor(lang,key){const index=META.findIndex(item=>item.key===key);return COPY[lang][index]}

function Sidebar({currentKey,lang,ui,words,role,routeKeys,completedGroups,onSelect}){
  let group=''
  return <aside className="op2-sidebar"><img src="/brand/logo_dark_bg_white_text.svg" alt="CFO AI"/>
    <div className="op2-role-route"><small>{words.rolePath}</small><b>{words.roles[role]}</b><span>{routeKeys.length} {words.modules}</span></div>
    <nav>{META.map(s=>{const start=s.group!==group;group=s.group;const included=routeKeys.includes(s.key);return <div key={s.key}>{start&&<small>{ui.groups[s.group]}{completedGroups.includes(s.group)&&<i><I name="check" size={10}/></i>}</small>}<button disabled={!included} title={!included?words.notInPath:undefined} className={s.key===currentKey?'active':!included?'excluded':''} onClick={()=>included&&onSelect(s.key)}><I name={s.icon} size={16}/><span>{copyFor(lang,s.key)[0]}</span></button></div>})}</nav>
    <div className="op2-user"><b>AC</b><span><strong>Andrey C.</strong><small>{ui.owner}</small></span></div>
  </aside>
}

function Visual({layout,d,ui,names}){
  if(layout==='chat')return <div className="op2-chat"><p><b>AC</b>{names[0]}</p><p><b>AI</b>{names[1]} <i>{ui.ready}</i></p></div>
  if(layout==='score')return <div className="op2-score"><strong>{d[0]}</strong><span><b>{names[0]}</b><i><em/></i><small>{names[1]}</small></span></div>
  if(layout==='flow')return <div className="op2-flow">{[ui.pending,ui.review,ui.ready].map((x,i)=><div key={x}><b>{i+1}</b><span>{x}</span></div>)}</div>
  if(layout==='bars'||layout==='risk')return <div className={'op2-bars '+layout}>{[44,69,58,82,73,91].map((h,i)=><i key={i} style={{height:h+'%'}}/>)}</div>
  if(layout==='settings')return <div className="op2-settings"><p><span>{names[0]}</span><b>{d[5]}</b></p><p><span>{names[1]}</span><b>{d[6]}</b></p></div>
  return <div className="op2-cards"><p><I name="wallet" size={18}/><span>{names[0]}</span><b>{d[5]}</b></p><p><I name="doc" size={18}/><span>{names[1]}</span><b>{d[6]}</b></p></div>
}

function AccountantWorkspace({lang,words,onOpen}){
  const [tab,setTab]=useState(0)
  const ranges=[[0,3],[3,7],[7,9],[9,10],[0,10]], [from,to]=ranges[tab]
  const visible=words.fields.slice(from,to)
  return <section className="op2-accounting-workspace">
    <header><div><small>AI ACCOUNTANT</small><h2>{words.accountantTitle}</h2><p>{words.accountantIntro}</p></div><span><b>82%</b><small>{words.readiness}</small></span></header>
    <div className="op2-accounting-layout"><nav>{words.tabs.map((label,index)=><button key={label} className={index===tab?'active':''} onClick={()=>setTab(index)}><span>{index<4?index+1:<I name="check" size={13}/>}</span>{label}<I name="chev" size={12}/></button>)}</nav>
      <article><div className="op2-accounting-heading"><span><small>{words.tabs[tab]}</small><b>{tab===4?words.readiness:words.accountantTitle}</b></span><i>{visible.filter((_,i)=>!(from+i===3||from+i===4)).length}/{visible.length}</i></div>
        <div className="op2-accounting-fields">{visible.map(([label,value],index)=>{const needs=(from+index===3||from+index===4);return <button key={label}><span><small>{label}</small><b>{value}</b></span><i className={needs?'needs':''}>{needs?words.needsWork:words.complete}</i></button>})}</div>
      </article>
      <aside><small>{words.readiness}</small><strong>82%</strong><i><em/></i><p>{words.fields.length-2} {words.complete.toLowerCase()} · 2 {words.needsWork.toLowerCase()}</p><Btn onClick={onOpen}>{words.openSetup}<I name="chev" size={13}/></Btn></aside>
    </div>
  </section>
}

function Page({step,copy,ui,words,lang,explore,selected,setSelected,onOpenRecord}){
  const d=DATA[step.key], body=ui.body(copy[0]), names=[copy[1],ui.attention+': '+copy[0]], accountant=step.key==='accountant'&&explore
  return <div className="op2-canvas"><header><div><b>A</b><span><strong>PT Aruna Commerce</strong><small>{ui.workspace}</small></span></div><aside><button>?</button><button>!</button><b>AC</b></aside></header>
    <section className="op2-page"><div className="op2-crumb">{ui.tour} / {ui.groups[step.group]} / <b>{copy[0]}</b></div>
      <div className="op2-title"><span><small>{ui.groups[step.group]}</small><h1>{copy[0]}</h1><p>{body}</p></span><button><I name="plus" size={14}/>{ui.newAction}</button></div>
      <div className="op2-kpis"><p><span>{ui.current}</span><b>{d[0]}</b><small>{ui.healthy}</small></p><p><span>{ui.attention}</span><b>{d[1]}</b><small>{ui.priority}</small></p><p><span>{ui.updated}</span><b>{d[2]}</b><small>{ui.time}</small></p></div>
      {accountant?<AccountantWorkspace lang={lang} words={words} onOpen={onOpenRecord}/>:<div className={'op2-grid '+(explore?'explore':'')}><article className="op2-main"><div className="op2-panel-title"><span><small>{ui.pageInside}</small><b>{copy[1]}</b></span><i>{ui.live}</i></div><Visual layout={step.layout} d={d} ui={ui} names={names}/>
        <div className="op2-table-head"><span>{ui.record}</span><span>{ui.amount}</span><span>{ui.status}</span></div>
        <div className="op2-rows">{[0,1].map(i=><button key={i} className={selected===i?'selected':''} onClick={()=>setSelected(i)}><I name={step.icon} size={15}/><strong>{names[i]}</strong><span>{d[5+i]}</span><b>{ui[d[7+i]]}</b><I name="chev" size={13}/></button>)}</div>
        <small className="op2-hint"><I name="cfo" size={13}/>{ui.hint}</small></article>
        <aside className="op2-detail"><small>{ui.detail}</small><i><I name={step.icon} size={21}/></i><h3>{names[selected]}</h3><p>{body}</p><dl><div><dt>{ui.amount}</dt><dd>{d[5+selected]}</dd></div><div><dt>{ui.status}</dt><dd>{ui[d[7+selected]]}</dd></div><div><dt>{ui.responsible}</dt><dd>{ui.team}</dd></div><div><dt>{ui.updated}</dt><dd>{ui.now}</dd></div></dl><button onClick={onOpenRecord}>{ui.open}<I name="chev" size={13}/></button></aside>
      </div>}
    </section>
  </div>
}

function RecordScreen({step,copy,ui,words,selected,onClose}){
  const d=DATA[step.key], names=[copy[1],ui.attention+': '+copy[0]], status=ui[d[7+selected]]
  return <section className="op2-record-screen"><header><button onClick={onClose}><I name="chev" size={15}/>{words.backPage}</button><span>{words.recordPage}</span><b>PT Aruna Commerce</b></header>
    <main><div className="op2-record-title"><span><small>{copy[0]}</small><h1>{step.key==='accountant'?words.accountantTitle:names[selected]}</h1><p>{ui.body(copy[0])}</p></span><i>{status}</i></div>
      <div className="op2-record-summary"><article><small>{ui.amount}</small><strong>{d[5+selected]}</strong></article><article><small>{ui.status}</small><strong>{status}</strong></article><article><small>{ui.responsible}</small><strong>{ui.team}</strong></article><article><small>{ui.updated}</small><strong>{ui.now}</strong></article></div>
      <div className="op2-record-body"><article><div><small>{words.activity}</small><h2>{words.timeline[2]}</h2></div><ol>{words.timeline.map((item,index)=><li key={item}><i>{index+1}</i><span><b>{item}</b><small>{index===2?ui.now:'09:'+(12+index*8)}</small></span>{index===2&&<em>{words.completed}</em>}</li>)}</ol></article>
        <aside><section><small>{words.evidence}</small><p><I name="doc" size={18}/><span><b>{step.key==='accountant'?'NPWP_Aruna.pdf':'Evidence_2026.pdf'}</b><small>{ui.uploaded}</small></span></p></section><section><small>{words.nextActions}</small><Btn>{ui.open}</Btn><Btn kind="secondary" onClick={onClose}>{words.backPage}</Btn></section></aside>
      </div>
    </main>
  </section>
}

function Checkpoint({ui,words,group,isLast,onContinue,onReview,onPause}){
  return <><div className="op2-scrim"/><section className="op2-checkpoint"><i><I name="check" size={28}/></i><small>{ui.groups[group]}</small><h2>{words.sectionComplete}</h2><p>{words.sectionBody}</p><div><Btn kind="secondary" onClick={onReview}>{words.reviewSection}</Btn><Btn onClick={onContinue}>{isLast?words.finishTour:words.continueSection}<I name="chev" size={14}/></Btn></div><button onClick={onPause}>{words.save}</button></section></>
}

export default function OnboardingTourPreview({lang='en',role='owner',initialProgress,onProgress,onExit}){
  const safe=COPY[lang]?lang:'en',ui=UI[safe],words=TOUR_WORDS[safe],routeKeys=ROLE_PATHS[role]||ROLE_PATHS.owner
  const steps=routeKeys.map(key=>META.find(item=>item.key===key)), savedIndex=initialProgress?.role===role?initialProgress.current:0
  const [current,setCurrent]=useState(Math.min(savedIndex||0,steps.length-1)),[explore,setExplore]=useState(false),[selected,setSelected]=useState(0)
  const [completedGroups,setCompletedGroups]=useState(initialProgress?.role===role?initialProgress.completedGroups||[]:[]),[checkpoint,setCheckpoint]=useState(null),[recordOpen,setRecordOpen]=useState(false)
  const step=steps[current],copy=copyFor(safe,step.key),groupIndexes=steps.map((item,index)=>item.group===step.group?index:-1).filter(index=>index>=0)
  const save=(index=current,groups=completedGroups)=>onProgress?.({role,current:index,completedGroups:groups,updatedAt:new Date().toISOString()})
  const select=(index,groups=completedGroups)=>{setCurrent(index);setSelected(0);setExplore(false);setRecordOpen(false);save(index,groups)}
  const selectKey=key=>{const index=steps.findIndex(item=>item.key===key);if(index>=0)select(index)}
  const groupEnd=current===steps.length-1||steps[current+1].group!==step.group
  const next=()=>groupEnd?setCheckpoint(step.group):select(current+1)
  const continueCheckpoint=()=>{const groups=[...new Set([...completedGroups,checkpoint])];setCompletedGroups(groups);setCheckpoint(null);if(current===steps.length-1){onProgress?.(null);onExit?.({complete:true})}else select(current+1,groups)}
  const pause=()=>{save();onExit?.({complete:false})}
  return <main className={'op2-shell '+(explore?'page-mode':'guide-mode')}><Sidebar currentKey={step.key} lang={safe} ui={ui} words={words} role={role} routeKeys={routeKeys} completedGroups={completedGroups} onSelect={selectKey}/><Page step={step} copy={copy} ui={ui} words={words} lang={safe} explore={explore} selected={selected} setSelected={setSelected} onOpenRecord={()=>setRecordOpen(true)}/>
    {!explore&&!checkpoint&&<><div className="op2-scrim"/><section className="op2-coach"><div><small>{words.rolePath}</small><b>{current+1} / {steps.length}</b></div><i className="op2-progress"><em style={{width:((current+1)/steps.length*100)+'%'}}/></i><label>{ui.groups[step.group]} <b>{groupIndexes.indexOf(current)+1}/{groupIndexes.length}</b></label><span className="op2-coach-copy"><i><I name={step.icon} size={22}/></i><div><small>{ui.guide}</small><h2>{copy[1]}</h2><p>{ui.body(copy[0])}</p></div></span><footer><Btn kind="ghost" disabled={current===0} onClick={()=>select(current-1)}>{ui.back}</Btn><button onClick={pause}>{words.save}</button><Btn kind="secondary" icon="list" onClick={()=>setExplore(true)}>{ui.explore}</Btn><Btn onClick={next}>{groupEnd?words.sectionComplete:ui.next}<I name="chev" size={14}/></Btn></footer></section></>}
    {explore&&!recordOpen&&<section className="op2-dock"><span><i><I name={step.icon} size={17}/></i><b><small>{ui.inside} - {current+1}/{steps.length}</small>{copy[0]}</b></span><Btn kind="secondary" onClick={()=>setExplore(false)}>{ui.backGuide}</Btn><Btn onClick={next}>{groupEnd?words.sectionComplete:ui.next}<I name="chev" size={14}/></Btn></section>}
    {checkpoint&&<Checkpoint ui={ui} words={words} group={checkpoint} isLast={current===steps.length-1} onContinue={continueCheckpoint} onReview={()=>{setCheckpoint(null);setExplore(true)}} onPause={pause}/>} {recordOpen&&<RecordScreen step={step} copy={copy} ui={ui} words={words} selected={selected} onClose={()=>setRecordOpen(false)}/>} </main>
}