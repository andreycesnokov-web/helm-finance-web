/**
 * CFO AI Multilingual Translation Dictionary
 * Comprehensive localization for English (EN), Bahasa Indonesia (ID), and Russian (RU).
 * Zero emojis across all languages.
 */

const translations = {
  en: {
    nav: {
      home: "Home",
      platform: "Platform",
      doc_intelligence: "Document Intelligence",
      compliance: "Tax & Compliance",
      hub: "Knowledge Hub",
      pricing: "Pricing",
      about: "About",
      login: "Log In",
      trial_cta: "Start Free Trial (7 Days)",
      app_link: "Open CFO AI Application"
    },
    announcement: {
      text: "Indonesia Tax Transition (PMK 81/2024 CoreTax) Readiness Package is now active.",
      link_text: "Read Director's Guide"
    },
    hero: {
      badge: "DESIGNED FOR INDONESIA • PT & PT PMA",
      title: "Know your numbers. Control your business.",
      subtitle: "Your AI Chief Financial Officer. Real-time cash visibility, document intelligence, bank statement reconciliation, and Indonesian tax compliance — unified in one financial operating system.",
      primary_cta: "Start Free Trial (7 Days)",
      secondary_cta: "Explore Platform Tour",
      disclaimer: "No credit card required • Instant company provisioning • Full access for 168 hours",
      live_feed_badge: "Live Operating Feed",
      hero_caption: "Pulse Command Center — PT Solusi Utama Nusantara"
    },
    kpis: {
      runway_label: "Cash Runway",
      runway_val: "162 Days",
      runway_sub: "Healthy operating buffer (>90 days)",
      net_flow_label: "30-Day Net Flow",
      net_flow_val: "+Rp 148.5M",
      net_flow_sub: "+14.2% vs previous period",
      recon_label: "Bank Reconciliation",
      recon_val: "100% Balanced",
      recon_sub: "BCA, Mandiri & Permata accounts",
      tax_label: "Tax Exposure",
      tax_val: "0 IDR Risk",
      tax_sub: "PPh 21 TER & PPN current"
    },
    pillars: {
      badge: "SIX CORE VALUE PILLARS",
      heading: "Engineered for Complete Financial Control",
      subheading: "Eliminate fragmented spreadsheets and disconnects between operations and accounting.",
      items: [
        {
          num: "01",
          title: "AI Chief Financial Officer",
          desc: "Composite health score (0-100), automated weekly executive briefings, and conversational ledger Q&A with exact voucher citations.",
          link: "Learn more"
        },
        {
          num: "02",
          title: "Document Intelligence & OCR",
          desc: "Multi-channel intake (web upload and mobile), AI vision extraction of vendor names, DPP, and PPN 11% with human review drawer.",
          link: "Review workflow"
        },
        {
          num: "03",
          title: "Indonesian Tax Radar",
          desc: "Indonesian statutory calendar monitoring, PPh 21 TER formulas, PPh 23, PPN 11%, and CoreTax PMK 81/2024 compliance advisories.",
          link: "Explore radar"
        },
        {
          num: "04",
          title: "Bank Statement Reconciliation",
          desc: "Import corporate bank statements, reconcile transactions automatically, and export one-click downloadable Accountant Readiness Packages.",
          link: "Inspect workflow"
        },
        {
          num: "05",
          title: "Multi-Entity & Treasury",
          desc: "Support for IDR, USD, EUR, and SGD multi-currency balances with real-time Bank Indonesia (BI) middle rate revaluations.",
          link: "View treasury"
        },
        {
          num: "06",
          title: "Role Permissions & Audit Trail",
          desc: "Rigid separation of duties between executive oversight, operator entry, and external tax consultants with immutable audit logs.",
          link: "Inspect security"
        }
      ]
    },
    personas: {
      badge: "BUILT FOR YOUR ROLE",
      heading: "Tailored Perspectives for Every Stakeholder",
      subheading: "Whether you own the company, manage operations, or audit monthly tax filings.",
      cards: [
        {
          role: "Founders & Directors",
          title: "Total Cash Clarity Without Micromanagement",
          desc: "Receive weekly automated financial executive summaries on WhatsApp or email. Know your exact runway in days and burn rate across all subsidiaries without digging through spreadsheets.",
          bullets: [
            "Real-time cash balance across all Indonesian bank accounts",
            "Predictive runway trajectory (30 / 60 / 90 days)",
            "Approval workflows for disbursements exceeding thresholds"
          ]
        },
        {
          badge: "Core Workflow",
          role: "In-House Finance Teams",
          title: "Eliminate 80% of Manual Ledger Work",
          desc: "Upload photos of receipts or PDF tax invoices. OCR extracts DPP, PPN 11%, and vendor details, automatically matching transactions to imported bank statement rows.",
          bullets: [
            "Corporate statement auto-matching and rule-based reconciliation",
            "Side-by-side OCR verification drawer with DPP/PPN split",
            "Automatic withholding tax (PPh 23) calculation"
          ]
        },
        {
          role: "Konsultan Pajak & CPAs",
          title: "Pre-Balanced Month-End Audit Packages",
          desc: "Stop chasing clients for missing receipts at month-end. Download a complete, pre-reconciled Accountant Readiness Package ZIP with structured General Ledger CSVs and tax schedules.",
          bullets: [
            "One-click Accountant Readiness ZIP download",
            "Pre-calculated PPh 21 TER schedules for payroll",
            "CoreTax PMK 81/2024 structured data export"
          ]
        }
      ]
    },
    scenarios: {
      badge: "REPRESENTATIVE DEPLOYMENTS",
      heading: "Proven Across Indonesian Operating Models",
      subheading: "Realistic operational outcomes delivered across technology services, hospitality, and commercial trade.",
      cards: [
        {
          location: "CASE 01 • JAKARTA SELATAN",
          company: "B2B Technology Services (PT PMA)",
          profile: "Growing team of 45 engineers and consultants with multi-bracket payroll.",
          quote: "Scaling from 15 to 45 employees created severe payroll tax calculation overhead. CFO AI automated our monthly PPh 21 TER brackets and eliminated 3 days of manual calculation every month.",
          outcome: "Outcome: 100% PPh 21 TER accuracy • Zero late filing notices"
        },
        {
          location: "CASE 02 • BADUNG, BALI",
          company: "Boutique Hospitality Operator",
          profile: "Operating 4 villa resorts across multiple operational bank accounts.",
          quote: "Managing hospitality cash flow across multiple corporate accounts used to mean blind spots. Pulse unified all liquidity in real-time, allowing our management to forecast seasonal villa expansion runway with total confidence.",
          outcome: "Outcome: Unified multi-property runway • 162 days visibility"
        },
        {
          location: "CASE 03 • JAKARTA BARAT",
          company: "Trading & Distribution PT PMA",
          profile: "High-volume wholesale vendor invoices with strict PPN 11% requirements.",
          quote: "Multi-currency supplier invoices and PPN 11% input/output reconciliation used to delay month-end closing by 10 days. With CFO AI, our closing cycle takes 48 hours.",
          outcome: "Outcome: 75% reduction in month-end reconciliation cycle"
        }
      ]
    },
    faqs: {
      badge: "FREQUENTLY ASKED QUESTIONS",
      heading: "Everything You Need to Know",
      subheading: "Clear answers about trial periods, bank compatibility, tax compliance, and data security.",
      items: [
        {
          q: "How does the 7-day free trial work?",
          a: "You get full, unrestricted access to your chosen plan for 168 hours (7 days). No credit card is required to register. You can upload documents, import bank statements, and run tax calculations immediately. If you decide not to subscribe, your data remains safely exportable."
        },
        {
          q: "Which bank statement formats are supported for reconciliation?",
          a: "CFO AI supports standard corporate statement exports from major Indonesian banks including Bank Central Asia (BCA Giro CSV and KlikBCA Bisnis), Bank Mandiri (MCM CSV), Bank Permata (e-Statement PDF/CSV), Bank Rakyat Indonesia (BRI), as well as international CSV/MT940 formats with auto-delimiter detection."
        },
        {
          q: "Does CFO AI replace our registered Indonesian Konsultan Pajak?",
          a: "No. CFO AI is an operational financial operating system, not a licensed tax consulting firm. It does not file official SPT tax returns on your behalf or provide formal legal audit opinions. Instead, it provides your in-house team and external Konsultan Pajak with structured, pre-balanced tax schedules and complete audit packages."
        },
        {
          q: "How is customer financial data protected under Indonesian Law?",
          a: "All data is encrypted in transit using TLS 1.3 and at rest with AES-256. We maintain strict compliance with Indonesia's Personal Data Protection Law (UU PDP / Law No. 27/2022). Each company's data resides in isolated database schemas. We enforce a strict zero-data-sharing policy: customer ledger data is never sold, shared, or used to train public AI models."
        },
        {
          q: "Is CFO AI ready for the PMK 81/2024 CoreTax transition?",
          a: "Yes. Our statutory compliance engine incorporates the new CoreTax data taxonomy mandated by the Directorate General of Taxes (DGT). Exported readiness packages include structured schemas matching the upcoming CoreTax filing format."
        }
      ]
    },
    platform: {
      badge: "PLATFORM ARCHITECTURE",
      heading: "A Complete Financial Operating System",
      subheading: "Discover how CFO AI replaces fragmented software with a unified, high-integrity financial operations workspace engineered for Indonesia.",
      primary_heading: "Core Operational Cockpit",
      primary_subheading: "Full uncropped visibility into liquidity, cash runway, and transaction streams.",
      secondary_heading: "Extended Management & Regulatory Modules",
      secondary_subheading: "Click any preview to inspect the full interface in high resolution.",
      click_to_enlarge: "Click to enlarge full UI",
      authentic_tag: "AUTHENTIC V2 SCREEN",
      modules: {
        pulse: {
          title: "Pulse Command Center",
          desc: "Executive financial cockpit offering unified multi-currency liquidity visibility across bank accounts and cash floats with real-time runway forecasting."
        },
        radar: {
          title: "Radar Forward Trajectory",
          desc: "Predictive cash flow modeling with 30, 60, and 90-day step horizons. Interactive what-if scenario levers simulate customer payment delays and corporate tax installments."
        },
        accounts: {
          title: "Accounts & Treasury Portfolio",
          desc: "Consolidated multi-account overview tracking balances across checking, savings, term deposits, and petty cash with currency revaluations."
        },
        transactions: {
          title: "Bank Transactions & Matching",
          desc: "Unified transaction stream with automatic categorization, status indicators, and rule-based matching against vendor bills and customer invoices."
        },
        bank_import: {
          title: "Bank Statement Import Engine",
          desc: "Import corporate bank statements (CSV, PDF, MT940), reconcile transactions automatically, and consolidate financial activity across business accounts."
        },
        invoicing: {
          title: "Invoicing & Accounts Receivable (AR)",
          desc: "Multi-currency sales invoicing with Indonesian Rupiah (IDR) statutory equivalents, aging analysis, customer tracking, and settlement records."
        },
        bills: {
          title: "Bills & Accounts Payable (AP)",
          desc: "Vendor bill management with approval thresholds, duplicate detection, payment scheduling, and automated withholding tax deduction (PPh 23)."
        },
        approvals: {
          title: "Disbursement Approval Queue",
          desc: "Configurable approval workflows enforcing internal controls on expenses and vendor payments exceeding authorized management thresholds."
        },
        doc_intelligence: {
          title: "Document Intelligence & OCR",
          desc: "Multimodal AI vision extraction for Indonesian tax invoices (Faktur Pajak) and receipts. Automatically parses vendor name, DPP, and PPN 11%."
        },
        ai_cfo: {
          title: "AI Chief Financial Officer",
          desc: "Conversational natural language interface answering ledger inquiries (e.g. 'What was our marketing burn last quarter?') with exact voucher citations."
        },
        ai_accountant: {
          title: "Accountant Readiness Packages",
          desc: "One-click export of an auditor-ready ZIP package containing balanced General Ledger CSVs, reconciliation logs, tax schedules, and receipt archives."
        },
        compliance: {
          title: "Indonesian Tax Radar",
          desc: "Continuous statutory calendar monitoring for PPh 21 TER, PPh 23, PPh 4(2), and PPN 11%. Automated tax worksheets prevent late penalties under UU KUP."
        },
        payroll: {
          title: "Payroll & PPh 21 TER Engine",
          desc: "Staff payroll calculation module applying government-mandated TER Categories A, B, and C tables per PP 58/2023 and PMK 168/2023."
        },
        multi_company: {
          title: "Multi-Entity Workspace Switching",
          desc: "Switch seamlessly between separate company entities (e.g. PT and PT PMA operations). Each business maintains isolated relational ledgers, independent bank accounts, and dedicated permissions."
        }
      }
    },
    doc_page: {
      badge: "DOCUMENT INTELLIGENCE",
      heading: "From Paper Receipt to General Ledger in Seconds",
      subheading: "Eliminate 80% of manual data entry with multimodal vision OCR, human-in-the-loop verification, and automated bank matching.",
      faktur_title: "Faktur Pajak & QR Scanner",
      faktur_desc: "Instantly parses DGT standard tax invoices, extracting Nomor Seri Faktur Pajak (NSFP), NPWP, DPP, and PPN 11% with automated QR validation.",
      intake_title: "Mobile & Drag-and-Drop Intake",
      intake_desc: "Finance teams upload PDFs or snap photos of receipts on mobile. CFO AI ingests the image and stages it for review within seconds.",
      review_title: "Human-in-the-Loop Verification",
      review_desc: "High-confidence extractions are flagged for quick one-click confirmation. Ambiguous handwriting is highlighted for operator review."
    },
    tax_page: {
      badge: "STATUTORY RADAR",
      heading: "Indonesian Tax & CoreTax Radar",
      subheading: "Stay ahead of PPh 21 TER, PPh 23, PPN 11%, and PMK 81/2024 CoreTax transition deadlines with automated calculation worksheets.",
      pph21_title: "PPh 21 TER Engine",
      pph21_desc: "Automatically calculates monthly employee withholding using Tarif Efektif Rata-Rata (TER Categories A, B, C) per PP 58/2023 and PMK 168/2023.",
      pph23_title: "PPh 23 & PPh 4(2) Withholding",
      pph23_desc: "Tracks 2% service withholding and final tax on commercial property leases, auto-generating Bukti Potong summaries for month-end filing.",
      ppn_title: "PPN 11% VAT Reconciliation",
      ppn_desc: "Cross-checks Pajak Keluaran (output VAT) against Pajak Masukan (input VAT) to ensure accurate net tax payable before the end-of-month deadline."
    },
    pricing_page: {
      badge: "TRANSPARENT SUBSCRIPTION PRICING",
      heading: "Simple, Transparent Subscription Pricing",
      subheading: "Designed for Indonesian PT and PT PMA businesses. No hidden setup fees. 7-day free trial on all plans.",
      monthly_btn: "Monthly Billing",
      annual_btn: "Annual Billing",
      discount_badge: "-20% DISCOUNT",
      per_month: "/ month (USD)",
      trial_badge: "7-Day Free Trial",
      limits_title: "Comprehensive Usage Entitlements",
      limits_sub: "Every limit is strictly enforced with zero silent penalties.",
      features_title: "Feature Matrix Comparison",
      features_sub: "Full functionality breakdown across Starter, Control, and Pro plans.",
      cat_financial_core: "Financial Core",
      cat_operations: "Operations & Spend Control",
      cat_ai_automation: "AI & Automation",
      cat_tax_compliance: "Tax & Compliance",
      cat_team_organization: "Team & Organization",
      cat_integrations_usage: "Integrations & Platform",
      custom_enterprise_title: "Need a custom multi-entity deployment?",
      custom_enterprise_desc: "For groups operating more than 5 Indonesian entities, holding companies, or specialized CoreTax ERP integrations.",
      custom_enterprise_btn: "Contact Enterprise Advisory"
    },
    cta_section: {
      heading: "Ready to take command of your business finances?",
      subheading: "Streamline cash visibility, automated bank reconciliation, and tax readiness with CFO AI.",
      note: "7-day free trial • No credit card required • Instant workspace setup"
    },
    about_page: {
      badge: "OUR MISSION",
      heading: "Empowering Indonesian Businesses With Total Financial Control",
      subheading: "CFO AI was built to eliminate the chaos of fragmented spreadsheets, delayed reconciliations, and regulatory compliance friction for companies operating in Indonesia.",
      footprint_title: "Operational Background & Footprint",
      footprint_p1: "Operating a PT or foreign-owned PT PMA in Indonesia involves distinct operational complexities: multi-currency transactions, unique withholding tax regimes (PPh 21 TER, PPh 23, PPh 4(2)), strict e-Faktur Pajak reconciliation, and the upcoming nationwide transition to the DGT CoreTax system.",
      footprint_p2: "CFO AI maintains direct engineering and client operations across Jakarta and Bali. Our platform is purpose-built to navigate Indonesian banking formats and local statutory accounting guidelines without expensive legacy enterprise consulting.",
      security_title: "Bank & Data Security",
      security_desc: "We enforce bank-grade AES-256 encryption at rest and TLS 1.3 in transit. Tenant databases are isolated with strict row-level segregation. We will never share or sell customer financial data.",
      privacy_title: "UU PDP Privacy Compliance",
      privacy_desc: "Fully aligned with Indonesia's Personal Data Protection Law (Law No. 27/2022). Customer financial entries are never used to train public commercial AI models."
    },
    footer: {
      about_text: "Financial Operating System engineered for Indonesian PT & PT PMA companies. Real-time cash visibility, tax invoice OCR, and automated bank reconciliation.",
      app_link: "app.cfo-ai.site",
      footprint: "Jakarta • Denpasar, Bali • Operating across Indonesia",
      col_platform: "Platform",
      col_hub: "Knowledge Hub",
      col_legal: "Company & Legal",
      copyright: "© 2026 CFO AI Indonesia. All rights reserved.",
      disclaimer: "CFO AI is an operational financial management system. It does not issue statutory audit opinions or replace a licensed Indonesian Konsultan Pajak.",
      link_overview: "Platform Overview",
      link_features: "Product Features",
      link_contact: "Contact Inquiries",
      link_privacy: "Privacy Policy (UU PDP)",
      link_terms: "Terms of Service",
      link_tax_guides: "PT PMA Tax Guide 2026",
      link_pph21: "PPh 21 TER Formulas",
      link_coretax: "CoreTax Transition Guide",
      back_to_top: "Back to Top"
    },
    lightbox: {
      authentic_badge: "AUTHENTIC V2 SCREEN",
      zoom_btn: "Zoom (1.5x)",
      zoom_reset: "Reset (1x)"
    }
  },

  id: {
    nav: {
      home: "Beranda",
      platform: "Platform",
      doc_intelligence: "Dokumen",
      compliance: "Pajak",
      hub: "Pusat Panduan",
      pricing: "Harga",
      about: "Tentang Kami",
      login: "Masuk",
      trial_cta: "Coba Gratis (7 Hari)",
      app_link: "Buka Aplikasi CFO AI"
    },
    announcement: {
      text: "Paket Kesiapan Transisi Pajak Indonesia (CoreTax PMK 81/2024) kini telah aktif.",
      link_text: "Baca Panduan Direktur"
    },
    hero: {
      badge: "DIRANCANG UNTUK INDONESIA • PT & PT PMA",
      title: "Kuasai angka Anda. Kendalikan bisnis Anda.",
      subtitle: "Chief Financial Officer berbasis AI Anda. Visibilitas arus kas real-time, intelijen dokumen, rekonsiliasi rekening koran bank, dan kepatuhan pajak Indonesia — terpadu dalam satu sistem operasi keuangan.",
      primary_cta: "Coba Gratis (7 Hari)",
      secondary_cta: "Jelajahi Tur Platform",
      disclaimer: "Tanpa kartu kredit • Aktivasi perusahaan instan • Akses penuh selama 168 jam",
      live_feed_badge: "Umpan Operasional Langsung",
      hero_caption: "Pulse Command Center — PT Solusi Utama Nusantara"
    },
    kpis: {
      runway_label: "Runway Kas",
      runway_val: "162 Hari",
      runway_sub: "Buffer operasional sehat (>90 hari)",
      net_flow_label: "Arus Bersih 30 Hari",
      net_flow_val: "+Rp 148,5 Jt",
      net_flow_sub: "+14,2% dibanding periode lalu",
      recon_label: "Rekonsiliasi Bank",
      recon_val: "100% Seimbang",
      recon_sub: "Rekening BCA, Mandiri & Permata",
      tax_label: "Risiko Pajak",
      tax_val: "0 IDR Risiko",
      tax_sub: "PPh 21 TER & PPN mutakhir"
    },
    pillars: {
      badge: "ENAM PILAR UTAMA",
      heading: "Dirancang untuk Kendali Keuangan Menyeluruh",
      subheading: "Hilangkan spreadsheet yang terfragmentasi dan ketidaksinkronan antara operasional dan akuntansi.",
      items: [
        {
          num: "01",
          title: "AI Chief Financial Officer",
          desc: "Skor kesehatan komposit (0-100), ringkasan eksekutif mingguan otomatis, dan tanya-jawab buku besar dengan kutipan bukti transaksi nyata.",
          link: "Pelajari lebih lanjut"
        },
        {
          num: "02",
          title: "Intelijen Dokumen & OCR",
          desc: "Pemasukan multi-kanal (web dan mobile), ekstraksi AI visi untuk nama vendor, DPP, dan PPN 11% dengan laci verifikasi manusia.",
          link: "Tinjau alur kerja"
        },
        {
          num: "03",
          title: "Radar Kepatuhan Pajak",
          desc: "Pemantauan kalender resmi pajak, formula PPh 21 TER, PPh 23, PPN 11%, dan notifikasi kepatuhan CoreTax PMK 81/2024.",
          link: "Jelajahi radar"
        },
        {
          num: "04",
          title: "Rekonsiliasi Rekening Koran",
          desc: "Impor rekening koran bank bisnis, rekonsiliasi transaksi secara otomatis, dan unduh Paket Kesiapan Akuntan dalam satu klik.",
          link: "Periksa alur"
        },
        {
          num: "05",
          title: "Multi-Entitas & Kas Multi-Valuta",
          desc: "Dukungan saldo multi-valuta IDR, USD, EUR, dan SGD dengan revaluasi kurs tengah Bank Indonesia (BI) secara berkala.",
          link: "Lihat kas"
        },
        {
          num: "06",
          title: "Izin Peran & Jejak Audit",
          desc: "Pemisahan tugas ketat antara pimpinan, operator keuangan, dan konsultan pajak eksternal dengan catatan audit yang tidak dapat diubah.",
          link: "Periksa keamanan"
        }
      ]
    },
    personas: {
      badge: "SESUAI PERAN ANDA",
      heading: "Perspektif Khusus untuk Setiap Pemangku Kepentingan",
      subheading: "Baik Anda pemilik bisnis, pengelola keuangan harian, atau konsultan pajak bulanan.",
      cards: [
        {
          role: "Pendiri & Direktur",
          title: "Kejelasan Kas Penuh Tanpa Mikromanajemen",
          desc: "Terima ringkasan eksekutif keuangan mingguan di WhatsApp atau email. Ketahui runway dalam hari dan burn rate di seluruh anak perusahaan tanpa membuka spreadsheet rumit.",
          bullets: [
            "Saldo kas real-time di seluruh rekening bank operasional",
            "Proyeksi lintasan kas masa depan (30 / 60 / 90 hari)",
            "Alur persetujuan untuk pengeluaran di atas batas otorisasi"
          ]
        },
        {
          badge: "Alur Inti",
          role: "Tim Keuangan Internal",
          title: "Pangkas 80% Beban Entri Jurnal Manual",
          desc: "Unggah foto kuitansi atau faktur pajak PDF. OCR mengekstrak DPP, PPN 11%, dan rincian vendor, mencocokkan otomatis dengan mutasi bank yang diimpor.",
          bullets: [
            "Pencocokan mutasi koran otomatis berbasis aturan",
            "Laci verifikasi OCR berdampingan dengan pemisahan DPP/PPN",
            "Perhitungan pemotongan pajak PPh 23 otomatis"
          ]
        },
        {
          role: "Konsultan Pajak & CPA",
          title: "Paket Audit Akhir Bulan yang Sudah Seimbang",
          desc: "Tidak perlu lagi mengejar klien untuk bukti transaksi yang hilang. Unduh Paket Kesiapan Akuntan (ZIP) lengkap dengan CSV Buku Besar dan lembar kerja pajak.",
          bullets: [
            "Unduh Paket Kesiapan Akuntan (ZIP) sekali klik",
            "Lembar kerja PPh 21 TER siap pakai untuk penggajian",
            "Ekspor data terstruktur sesuai skema CoreTax PMK 81/2024"
          ]
        }
      ]
    },
    scenarios: {
      badge: "PROFIL IMPLEMENTASI NYATA",
      heading: "Terbukti di Berbagai Model Bisnis di Indonesia",
      subheading: "Hasil operasional nyata yang dihadirkan di sektor layanan teknologi, perhotelan, dan perdagangan komersial.",
      cards: [
        {
          location: "KASUS 01 • JAKARTA SELATAN",
          company: "Layanan Teknologi B2B (PT PMA)",
          profile: "Tim 45 insinyur dan konsultan dengan struktur gaji multi-golongan.",
          quote: "Berkembang dari 15 ke 45 staf membuat perhitungan pajak gaji sangat membebani. CFO AI mengotomatisasi tarif PPh 21 TER dan memangkas 3 hari kerja manual setiap bulan.",
          outcome: "Hasil: 100% akurasi PPh 21 TER • Nol surat teguran pajak"
        },
        {
          location: "KASUS 02 • BADUNG, BALI",
          company: "Pengelola Vila & Perhotelan",
          profile: "Mengoperasikan 4 resor vila di berbagai rekening bank perusahaan.",
          quote: "Mengelola arus kas operasional antar berbagai rekening bank sering kali menimbulkan titik buta. Pulse menyatukan seluruh likuiditas secara real-time, memberi kepastian penuh bagi ekspansi vila.",
          outcome: "Hasil: Runway kas terpadu • Visibilitas 162 hari"
        },
        {
          location: "KASUS 03 • JAKARTA BARAT",
          company: "Perdagangan & Distribusi (PT PMA)",
          profile: "Volume faktur pemasok tinggi dengan rekonsiliasi PPN 11% yang ketat.",
          quote: "Faktur vendor multi-valuta dan rekonsiliasi Pajak Masukan/Keluaran biasanya menunda penutupan buku hingga 10 hari. Dengan CFO AI, penutupan kami selesai dalam 48 jam.",
          outcome: "Hasil: Pengurangan 75% siklus rekonsiliasi bulanan"
        }
      ]
    },
    faqs: {
      badge: "PERTANYAAN UMUM",
      heading: "Semua yang Perlu Anda Ketahui",
      subheading: "Jawaban jelas tentang masa percobaan, kompatibilitas bank, kepatuhan pajak, dan keamanan data.",
      items: [
        {
          q: "Bagaimana cara kerja uji coba gratis 7 hari?",
          a: "Anda mendapatkan akses penuh tanpa batas ke paket pilihan Anda selama 168 jam (7 hari). Tidak diperlukan kartu kredit saat mendaftar. Anda dapat langsung mengunggah dokumen, mengimpor rekening koran, dan menjalankan perhitungan pajak. Jika tidak melanjutkan, data Anda tetap dapat diekspor."
        },
        {
          q: "Format rekening koran bank mana yang didukung untuk rekonsiliasi?",
          a: "CFO AI mendukung ekspor rekening koran standar dari bank-bank utama di Indonesia termasuk Bank Central Asia (BCA Giro CSV dan KlikBCA Bisnis), Bank Mandiri (MCM CSV), Bank Permata (e-Statement PDF/CSV), Bank Rakyat Indonesia (BRI), serta format CSV/MT940 internasional dengan deteksi pemisah otomatis."
        },
        {
          q: "Apakah CFO AI menggantikan Konsultan Pajak terdaftar kami?",
          a: "Tidak. CFO AI adalah sistem operasi keuangan operasional, bukan kantor konsultan pajak berizin. Kami tidak menyampaikan SPT resmi atas nama Anda atau memberikan opini audit hukum. CFO AI menyediakan lembar kerja pajak dan paket audit yang terstruktur rapi untuk mempermudah akuntan Anda."
        },
        {
          q: "Bagaimana data keuangan dilindungi berdasarkan Hukum Indonesia?",
          a: "Semua data dienkripsi saat transit menggunakan TLS 1.3 dan saat disimpan dengan AES-256 sesuai dengan Undang-Undang Perlindungan Data Pribadi (UU PDP No. 27/2022). Data setiap perusahaan berada dalam skema terisolasi dan kami menjamin data keuangan pelanggan tidak pernah dijual atau dipakai untuk melatih model AI publik."
        },
        {
          q: "Apakah CFO AI siap untuk transisi CoreTax PMK 81/2024?",
          a: "Ya. Mesin kepatuhan kami menerapkan taksonomi data CoreTax baru dari Direktorat Jenderal Pajak (DJP). Paket kesiapan yang diekspor menyertakan format terstruktur yang cocok dengan sistem CoreTax."
        }
      ]
    },
    platform: {
      badge: "ARSITEKTUR PLATFORM",
      heading: "Sistem Operasi Keuangan Menyeluruh",
      subheading: "Ketahui bagaimana CFO AI menggantikan perangkat lunak yang terpisah-pisah dengan ruang kerja operasional keuangan terpadu berintegritas tinggi untuk Indonesia.",
      primary_heading: "Kokpit Operasional Inti",
      primary_subheading: "Visibilitas penuh tanpa potongan gambar terhadap likuiditas, runway, dan mutasi transaksi.",
      secondary_heading: "Modul Manajemen & Regulasi Lanjutan",
      secondary_subheading: "Klik pratinjau mana pun untuk melihat antarmuka lengkap dalam resolusi tinggi.",
      click_to_enlarge: "Klik untuk memperbesar tampilan penuh",
      authentic_tag: "TAMPILAN NYATA V2",
      modules: {
        pulse: {
          title: "Pulse Command Center",
          desc: "Kokpit keuangan eksekutif yang menawarkan visibilitas likuiditas multi-valuta di seluruh rekening bank dan kas kecil dengan proyeksi runway real-time."
        },
        radar: {
          title: "Radar Proyeksi Kas",
          desc: "Pemodelan arus kas prediktif dengan cakrawala 30, 60, dan 90 hari. Pengungkit skenario interaktif untuk mensimulasikan keterlambatan pembayaran pelanggan dan angsuran pajak."
        },
        accounts: {
          title: "Portofolio Rekening & Kas",
          desc: "Ikhtisar multi-rekening terkonsolidasi yang melacak saldo giro, tabungan, deposito, dan kas kecil dengan penyesuaian nilai valuta asing."
        },
        transactions: {
          title: "Transaksi & Pencocokan Bank",
          desc: "Aliran transaksi terpadu dengan kategorisasi otomatis, indikator status, dan pencocokan berbasis aturan terhadap tagihan vendor dan faktur penjualan."
        },
        bank_import: {
          title: "Mesin Impor Rekening Koran",
          desc: "Impor rekening koran bank perusahaan (CSV, PDF, MT940), rekonsiliasi transaksi secara otomatis, dan konsolidasi aktivitas di seluruh rekening."
        },
        invoicing: {
          title: "Faktur & Piutang Usaha (AR)",
          desc: "Penerbitan faktur penjualan multi-valuta dengan ekuivalen Rupiah (IDR), analisis umur piutang, pelacakan pelanggan, dan bukti pelunasan."
        },
        bills: {
          title: "Tagihan & Utang Usaha (AP)",
          desc: "Manajemen tagihan vendor dengan batas persetujuan, deteksi duplikasi, penjadwalan pembayaran, dan pemotongan otomatis PPh 23."
        },
        approvals: {
          title: "Antrean Persetujuan Pengeluaran",
          desc: "Alur kerja persetujuan yang dapat disesuaikan untuk menerapkan kontrol internal atas biaya dan pembayaran vendor yang melebihi batas otorisasi."
        },
        doc_intelligence: {
          title: "Intelijen Dokumen & OCR",
          desc: "Ekstraksi AI visi multimodal untuk Faktur Pajak Indonesia dan kuitansi. Mengekstrak nama vendor, DPP, dan PPN 11% secara otomatis."
        },
        ai_cfo: {
          title: "AI Chief Financial Officer",
          desc: "Antarmuka percakapan bahasa alami untuk menjawab pertanyaan buku besar (contoh: 'Berapa pengeluaran pemasaran kuartal lalu?') disertai kutipan bukti nyata."
        },
        ai_accountant: {
          title: "Paket Kesiapan Akuntan",
          desc: "Ekspor satu klik paket arsip ZIP siap audit yang berisi CSV Buku Besar seimbang, log rekonsiliasi, lembar kerja pajak, dan arsip bukti kuitansi."
        },
        compliance: {
          title: "Radar Kepatuhan Pajak Indonesia",
          desc: "Pemantauan kalender pajak berkelanjutan untuk PPh 21 TER, PPh 23, PPh 4(2), dan PPN 11%. Lembar kerja otomatis mencegah sanksi keterlambatan UU KUP."
        },
        payroll: {
          title: "Penggajian & Mesin PPh 21 TER",
          desc: "Modul perhitungan gaji staf menerapkan tabel TER Kategori A, B, dan C pemerintah sesuai PP 58/2023 dan PMK 168/2023."
        },
        multi_company: {
          title: "Pergantian Ruang Kerja Multi-Entitas",
          desc: "Beralih secara instan antara entitas bisnis yang berbeda (operasi PT dan PT PMA). Setiap perusahaan memiliki buku besar terisolasi, rekening bank independen, dan hak akses khusus."
        }
      }
    },
    doc_page: {
      badge: "INTELIJEN DOKUMEN",
      heading: "Dari Kuitansi Kertas ke Buku Besar dalam Hitungan Detik",
      subheading: "Pangkas 80% entri data manual dengan OCR visi multimodal, verifikasi manusia, dan pencocokan otomatis ke rekening koran.",
      faktur_title: "Faktur Pajak & Pemindai QR",
      faktur_desc: "Mengekstrak faktur pajak standar DJP, membaca Nomor Seri Faktur Pajak (NSFP), NPWP, DPP, dan PPN 11% dengan validasi QR otomatis.",
      intake_title: "Pemasukan Mobile & Unggah Berkas",
      intake_desc: "Tim keuangan mengunggah PDF atau memotret kuitansi dari ponsel. CFO AI memproses gambar dan menyiapkannya untuk ditinjau dalam hitungan detik.",
      review_title: "Verifikasi Berdampingan",
      review_desc: "Hasil ekstraksi tingkat keyakinan tinggi ditandai untuk konfirmasi cepat. Tulisan tangan yang kurang jelas disorot untuk peninjauan operator."
    },
    tax_page: {
      badge: "RADAR KEPATUHAN",
      heading: "Radar Pajak Indonesia & CoreTax",
      subheading: "Antisipasi tenggat waktu PPh 21 TER, PPh 23, PPN 11%, dan transisi CoreTax PMK 81/2024 dengan lembar kerja perhitungan otomatis.",
      pph21_title: "Mesin PPh 21 TER",
      pph21_desc: "Menghitung pemotongan bulanan karyawan menggunakan Tarif Efektif Rata-Rata (TER Kategori A, B, C) sesuai PP 58/2023 dan PMK 168/2023.",
      pph23_title: "Pemotongan PPh 23 & PPh 4(2)",
      pph23_desc: "Melacak pemotongan 2% jasa dan pajak final sewa tempat usaha komersial, membuat rekap Bukti Potong untuk pelaporan bulanan.",
      ppn_title: "Rekonsiliasi PPN 11%",
      ppn_desc: "Mencocokkan Pajak Keluaran terhadap Pajak Masukan untuk memastikan keakuratan pajak kurang bayar sebelum batas waktu akhir bulan."
    },
    pricing_page: {
      badge: "HARGA LANGGANAN TRANSPARAN",
      heading: "Harga Langganan Sederhana & Transparan",
      subheading: "Dirancang untuk PT dan PT PMA di Indonesia. Tanpa biaya setup tersembunyi. Uji coba gratis 7 hari di semua paket.",
      monthly_btn: "Tagihan Bulanan",
      annual_btn: "Tagihan Tahunan",
      discount_badge: "DISKON -20%",
      per_month: "/ bulan (USD)",
      trial_badge: "Coba Gratis 7 Hari",
      limits_title: "Rincian Hak Operasional Lengkap",
      limits_sub: "Setiap batasan diberlakukan secara transparan tanpa denda tersembunyi.",
      features_title: "Perbandingan Matriks Fitur",
      features_sub: "Rincian modul lengkap antara paket Starter, Control, dan Pro.",
      cat_financial_core: "Inti Keuangan",
      cat_operations: "Operasional & Kontrol Biaya",
      cat_ai_automation: "AI & Otomasi",
      cat_tax_compliance: "Pajak & Kepatuhan",
      cat_team_organization: "Tim & Organisasi",
      cat_integrations_usage: "Integrasi & Platform",
      custom_enterprise_title: "Membutuhkan implementasi khusus multi-entitas?",
      custom_enterprise_desc: "Untuk grup dengan lebih dari 5 entitas di Indonesia, perusahaan holding, atau integrasi ERP CoreTax khusus.",
      custom_enterprise_btn: "Hubungi Tim Penasihat Enterprise"
    },
    cta_section: {
      heading: "Siap mengontrol keuangan bisnis Anda secara menyeluruh?",
      subheading: "Kelola arus kas, rekonsiliasi bank otomatis, dan kepatuhan pajak bersama CFO AI.",
      note: "Uji coba 7 hari gratis • Tanpa kartu kredit • Pengaturan instan"
    },
    about_page: {
      badge: "MISI KAMI",
      heading: "Memberdayakan Bisnis Indonesia dengan Kendali Keuangan Menyeluruh",
      subheading: "CFO AI dibangun untuk mengakhiri kekacauan spreadsheet terpisah, rekonsiliasi yang lambat, dan kendala kepatuhan regulasi bagi perusahaan di Indonesia.",
      footprint_title: "Latar Belakang Operasional & Jejak Langkah",
      footprint_p1: "Mengoperasikan PT atau PT PMA penanaman modal asing di Indonesia memiliki tantangan tersendiri: transaksi multi-valuta, aturan pemotongan pajak khusus (PPh 21 TER, PPh 23, PPh 4(2)), rekonsiliasi e-Faktur ketat, dan transisi nasional ke sistem CoreTax DJP.",
      footprint_p2: "CFO AI menjalankan operasional rekayasa dan pendampingan klien langsung di Jakarta dan Bali. Platform kami dirancang khusus untuk format perbankan Indonesia dan pedoman akuntansi resmi tanpa biaya konsultasi warisan yang mahal.",
      security_title: "Keamanan Data & Perbankan",
      security_desc: "Kami menerapkan enkripsi standar perbankan AES-256 saat tersimpan dan TLS 1.3 saat transit. Basis data klien diisolasi ketat. Kami tidak akan pernah membagikan atau menjual data keuangan Anda.",
      privacy_title: "Kepatuhan UU PDP Indonesia",
      privacy_desc: "Sepenuhnya selaras dengan Undang-Undang Perlindungan Data Pribadi (UU No. 27/2022). Data pembukuan pelanggan tidak pernah dipakai untuk melatih model AI komersial publik."
    },
    footer: {
      about_text: "Sistem Operasi Keuangan terintegrasi untuk PT & PT PMA di Indonesia. Visibilitas arus kas real-time, OCR faktur pajak, dan rekonsiliasi bank otomatis.",
      app_link: "app.cfo-ai.site",
      footprint: "Jakarta • Denpasar, Bali • Melayani seluruh Indonesia",
      col_platform: "Platform",
      col_hub: "Pusat Panduan",
      col_legal: "Perusahaan & Hukum",
      copyright: "© 2026 CFO AI Indonesia. Hak cipta dilindungi undang-undang.",
      disclaimer: "CFO AI adalah sistem manajemen keuangan operasional. Kami tidak menerbitkan opini audit resmi atau menggantikan Konsultan Pajak terdaftar.",
      link_overview: "Ringkasan Platform",
      link_features: "Fitur Produk",
      link_contact: "Kontak & Layanan",
      link_privacy: "Kebijakan Privasi (UU PDP)",
      link_terms: "Syarat & Ketentuan",
      link_tax_guides: "Panduan Pajak PT PMA 2026",
      link_pph21: "Rumus PPh 21 TER",
      link_coretax: "Panduan Transisi CoreTax",
      back_to_top: "Kembali ke Atas"
    },
    lightbox: {
      authentic_badge: "TAMPILAN NYATA V2",
      zoom_btn: "Perbesar (1.5x)",
      zoom_reset: "Normal (1x)"
    }
  },

  ru: {
    nav: {
      home: "Главная",
      platform: "Платформа",
      doc_intelligence: "Документы",
      compliance: "Налоги",
      hub: "База знаний",
      pricing: "Тарифы",
      about: "О нас",
      login: "Войти",
      trial_cta: "Попробовать бесплатно",
      app_link: "Открыть приложение CFO AI"
    },
    announcement: {
      text: "Пакет готовности к налоговой реформе Индонезии (CoreTax PMK 81/2024) активирован.",
      link_text: "Руководство директора"
    },
    hero: {
      badge: "РАЗРАБОТАНО ДЛЯ ИНДОНЕЗИИ • PT И PT PMA",
      title: "Знайте свои цифры. Управляйте бизнесом.",
      subtitle: "Ваш финансовый директор на базе ИИ. Контроль денежных потоков в реальном времени, распознавание счетов, сверка банковских выписок и налоговый комплаенс Индонезии в единой операционной системе.",
      primary_cta: "Попробовать бесплатно (7 дней)",
      secondary_cta: "Обзор платформы",
      disclaimer: "Банковская карта не требуется • Мгновенное подключение • Полный доступ на 168 часов",
      live_feed_badge: "Живой поток операций",
      hero_caption: "Командный центр Pulse — PT Solusi Utama Nusantara"
    },
    kpis: {
      runway_label: "Запас прочности (Runway)",
      runway_val: "162 Дня",
      runway_sub: "Здоровый операционный запас (>90 дней)",
      net_flow_label: "Чистый поток за 30 дней",
      net_flow_val: "+Rp 148.5M",
      net_flow_sub: "+14.2% к прошлому периоду",
      recon_label: "Сверка счетов",
      recon_val: "100% Сверено",
      recon_sub: "Счета BCA, Mandiri и Permata",
      tax_label: "Налоговый риск",
      tax_val: "0 IDR Риск",
      tax_sub: "PPh 21 TER и НДС рассчитаны"
    },
    pillars: {
      badge: "ШЕСТЬ КЛЮЧЕВЫХ ПРЕИМУЩЕСТВ",
      heading: "Создано для полного финансового контроля",
      subheading: "Устраните разрозненные таблицы и расхождения между операционной деятельностью и бухгалтерией.",
      items: [
        {
          num: "01",
          title: "AI Финансовый Директор",
          desc: "Комплексный индекс здоровья бизнеса (0-100), автоматические еженедельные брифинги и диалоговый аудит главной книги со ссылками на первичные документы.",
          link: "Подробнее"
        },
        {
          num: "02",
          title: "Распознавание документов и OCR",
          desc: "Мультиканальная загрузка (веб и мобильная), компьютерное зрение для извлечения поставщика, базы DPP и НДС (PPN 11%) с панелью верификации.",
          link: "Обзор процессов"
        },
        {
          num: "03",
          title: "Налоговый радар Индонезии",
          desc: "Мониторинг налогового календаря, формулы PPh 21 TER, налог у источника PPh 23, PPN 11% и подготовка к реформе CoreTax PMK 81/2024.",
          link: "Открыть радар"
        },
        {
          num: "04",
          title: "Сверка банковских выписок",
          desc: "Импорт корпоративных выписок, автоматическое сопоставление транзакций и выгрузка готового аудиторского пакета для бухгалтера в один клик.",
          link: "Смотреть сверку"
        },
        {
          num: "05",
          title: "Мультивалютное казначейство",
          desc: "Поддержка счетов в IDR, USD, EUR и SGD с переоценкой остатков по официальному среднему курсу Банка Индонезии (BI).",
          link: "Казначейство"
        },
        {
          num: "06",
          title: "Разделение ролей и аудит-лог",
          desc: "Четкое разграничение прав директоров, финансовых операторов и внешних налоговых консультантов с неизменяемым журналом действий.",
          link: "Безопасность"
        }
      ]
    },
    personas: {
      badge: "ДЛЯ ВАШЕЙ РОЛИ",
      heading: "Персональные инструменты для каждого участника",
      subheading: "Для владельцев бизнеса, штатных финансистов и независимых налоговых консультантов.",
      cards: [
        {
          role: "Основатели и Директора",
          title: "Прозрачность финансов без микроменеджмента",
          desc: "Еженедельные финансовые сводки в WhatsApp или на почту. Точный остаток ликвидности в днях и скорость расхода средств по всем филиалам без блуждания по таблицам.",
          bullets: [
            "Баланс в реальном времени по всем счетам индонезийских банков",
            "Прогноз кассовых разрывов и остатка средств (30 / 60 / 90 дней)",
            "Маршруты согласования платежей сверх установленных лимитов"
          ]
        },
        {
          badge: "Основной процесс",
          role: "Финансовая команда",
          title: "Сокращение до 80% ручного ввода проводок",
          desc: "Загружайте фото чеков или PDF налоговых счетов. Модуль OCR распознает DPP, НДС 11% и поставщика, сопоставляя их со строками банковской выписки.",
          bullets: [
            "Автосопоставление выписок по правилам сверки",
            "Двухоконная панель проверки OCR с выделением налоговой базы",
            "Авторасчет налога у источника (PPh 23)"
          ]
        },
        {
          role: "Konsultan Pajak и Аудиторы",
          title: "Сверенные отчетные пакеты в конце каждого месяца",
          desc: "Больше не нужно выпрашивать у клиента недостающие чеки. Скачивайте готовый архив Accountant Readiness Package (ZIP) со сверенным журналом и налоговыми ведомостями.",
          bullets: [
            "Скачивание полного архива закрытия месяца в один клик",
            "Автоматические ведомости зарплатного налога PPh 21 TER",
            "Экспорт структурированных данных для системы CoreTax PMK 81/2024"
          ]
        }
      ]
    },
    scenarios: {
      badge: "ПРИМЕРЫ ВНЕДРЕНИЯ",
      heading: "Проверено на реальных индонезийских компаниях",
      subheading: "Практические результаты в ИТ-секторе, гостиничном бизнесе и международной торговле.",
      cards: [
        {
          location: "КЕЙС 01 • ЮЖНАЯ ДЖАКАРТА",
          company: "ИТ-компания B2B (PT PMA)",
          profile: "Штат из 45 инженеров и консультантов с прогрессивными ставками зарплат.",
          quote: "При росте штата с 15 до 45 сотрудников расчет зарплатных налогов стал кошмаром. CFO AI автоматизировал сетку PPh 21 TER и сэкономил нам 3 рабочих дня каждый месяц.",
          outcome: "Результат: 100% точность PPh 21 TER • Ноль налоговых штрафов"
        },
        {
          location: "КЕЙС 02 • БАДУНГ, БАЛИ",
          company: "Управляющая компания курортами",
          profile: "Управление 4 вилловыми комплексами через раздельные расчетные счета.",
          quote: "Управление денежными потоками курорта по нескольким корпоративным счетам раньше создавало слепые зоны. Модуль Pulse объединил ликвидность в реальном времени, обеспечив уверенность при расширении.",
          outcome: "Результат: Единый мониторинг объектов • Горизонт 162 дня"
        },
        {
          location: "КЕЙС 03 • ЗАПАДНАЯ ДЖАКАРТА",
          company: "Торгово-дистрибьюторская PT PMA",
          profile: "Большой объем оптовых счетов и строгие требования к зачету НДС (PPN 11%).",
          quote: "Мультивалютные счета поставщиков и сопоставление входящего и исходящего НДС затягивали закрытие месяца на 10 дней. С CFO AI мы закрываем период за 48 часов.",
          outcome: "Результат: Закрытие периода быстрее на 75%"
        }
      ]
    },
    faqs: {
      badge: "ВОПРОСЫ И ОТВЕТЫ",
      heading: "Все, что нужно знать перед началом работы",
      subheading: "Ответы о пробном периоде, поддержке банков, налогах и безопасности данных.",
      items: [
        {
          q: "Как работает 7-дневный пробный период?",
          a: "Вы получаете полный доступ ко всем функциям выбранного тарифа на 168 часов (7 дней). Ввод банковской карты не требуется. Вы можете загружать документы, выписки и рассчитывать налоги. При отказе от подписки данные сохраняются для выгрузки."
        },
        {
          q: "Какие форматы банковских выписок поддерживаются?",
          a: "CFO AI поддерживает стандартные корпоративные выписки ведущих банков Индонезии: Bank Central Asia (BCA Giro CSV и KlikBCA Bisnis), Bank Mandiri (MCM CSV), Bank Permata (e-Statement PDF/CSV), Bank Rakyat Indonesia (BRI), а также универсальные форматы CSV и MT940 с автоопределением разделителей."
        },
        {
          q: "Заменяет ли CFO AI лицензированного налогового консультанта (Konsultan Pajak)?",
          a: "Нет. CFO AI — это операционная финансовая система, а не лицензированная аудиторская фирма. Мы не подписываем официальные налоговые декларации SPT за клиента. Платформа формирует структурированные сверенные ведомости и пакет документов, помогая вашему бухгалтеру готовить отчеты без ошибок."
        },
        {
          q: "Как защищены финансовые данные в соответствии с законами Индонезии?",
          a: "Все данные шифруются по протоколам TLS 1.3 при передаче и AES-256 при хранении в соответствии с Законом о защите персональных данных (UU PDP No. 27/2022). Каждая компания работает в изолированной схеме базы данных. Финансовые данные клиентов ни при каких условиях не передаются третьим лицам и не используются для обучения публичных нейросетей."
        },
        {
          q: "Готова ли система к переходу на государственную платформу CoreTax (PMK 81/2024)?",
          a: "Да. Наш комплаенс-модуль учитывает новую таксономию данных налоговой службы Индонезии (DGT). Экспортируемые архивы готовности формируются в строгом соответствии со структурой CoreTax."
        }
      ]
    },
    platform: {
      badge: "АРХИТЕКТУРА ПЛАТФОРМЫ",
      heading: "Единая финансовая операционная система",
      subheading: "Узнайте, как CFO AI заменяет разрозненный софт целостной финансовой средой, спроектированной под требования бизнеса в Индонезии.",
      primary_heading: "Основной операционный командный центр",
      primary_subheading: "Полный, не обрезанный обзор ликвидности, запаса прочности и реестра операций.",
      secondary_heading: "Специализированные и регуляторные модули",
      secondary_subheading: "Нажмите на любой скриншот, чтобы открыть полный интерфейс в высоком разрешении.",
      click_to_enlarge: "Нажмите для полноэкранного просмотра",
      authentic_tag: "РЕАЛЬНЫЙ ИНТЕРФЕЙС V2",
      modules: {
        pulse: {
          title: "Pulse Command Center",
          desc: "Главный финансовый экран руководителя: консолидированная мультивалютная ликвидность на счетах и в кассе с расчетом запаса прочности в реальном времени."
        },
        radar: {
          title: "Radar Прогноз Ликвидности",
          desc: "Прогностическое моделирование денежных потоков на 30, 60 и 90 дней. Интерактивные рычаги сценариев позволяют симулировать задержки оплат и налоговые платежи."
        },
        accounts: {
          title: "Счета и Казначейский Портфель",
          desc: "Консолидированный обзор расчетных счетов, депозитов и кассы с валютной переоценкой остатков."
        },
        transactions: {
          title: "Банковские Транзакции и Сверка",
          desc: "Единый реестр операций с автокатегоризацией, индикаторами статуса и сопоставлением со счетами поставщиков и клиентов."
        },
        bank_import: {
          title: "Модуль Импорта Выписок",
          desc: "Импорт корпоративных выписок (CSV, PDF, MT940), автоматическое сопоставление проводок и объединение финансовой активности по счетам бизнеса."
        },
        invoicing: {
          title: "Счета Клиентам и Дебиторская Задолженность (AR)",
          desc: "Выставление мультивалютных счетов с обязательным рупийным эквивалентом (IDR), анализ старения долгов и фиксация оплат."
        },
        bills: {
          title: "Счета Поставщиков и Кредиторская Задолженность (AP)",
          desc: "Учет входящих счетов с проверкой дубликатов, графиком оплат и удержанием налога на услуги PPh 23."
        },
        approvals: {
          title: "Очередь Согласования Платежей",
          desc: "Настраиваемые маршруты акцепта расходов и платежей поставщикам, превышающих лимиты операционных полномочий."
        },
        doc_intelligence: {
          title: "Распознавание Документов и OCR",
          desc: "Зрительное распознавание налоговых счетов Faktur Pajak и чеков: автоматическое считывание поставщика, базы DPP и НДС (PPN 11%)."
        },
        ai_cfo: {
          title: "AI Финансовый Директор",
          desc: "Диалоговый ассистент на естественном языке, отвечающий на вопросы по главной книге (например: 'Сколько мы потратили на маркетинг в Q2?') с точными ссылками на ордера."
        },
        ai_accountant: {
          title: "Пакеты Закрытия для Бухгалтера",
          desc: "Выгрузка готового ZIP-пакета со сверенным журналом главной книги, протоколом сверки, налоговыми ведомостями и копиями чеков в один клик."
        },
        compliance: {
          title: "Налоговый Радар Индонезии",
          desc: "Непрерывный мониторинг сроков по PPh 21 TER, PPh 23, PPh 4(2) и PPN 11%. Автоматические ведомости защищают от штрафов UU KUP."
        },
        payroll: {
          title: "Зарплатный Модуль и PPh 21 TER",
          desc: "Расчет налогов с фонда оплаты труда по государственным таблицам TER категорий A, B и C согласно PP 58/2023 и PMK 168/2023."
        },
        multi_company: {
          title: "Переключение Между Юрлицами (Multi-Entity)",
          desc: "Быстрое переключение между независимыми юридическими лицами (PT и PT PMA). Каждая компания работает в изолированном защищенном контуре со своими счетами, правами и отчетностью."
        }
      }
    },
    doc_page: {
      badge: "РАСПОЗНАВАНИЕ ДОКУМЕНТОВ",
      heading: "От бумажного чека до проводки за считанные секунды",
      subheading: "Устраните до 80% рутинного ввода благодаря компьютерному зрению OCR, проверке оператором и автоматической сверке с банковскими выписками.",
      faktur_title: "Faktur Pajak и Сканер QR",
      faktur_desc: "Мгновенное чтение стандартных налоговых счетов DGT, извлечение номеров NSFP, NPWP, налоговой базы DPP и НДС 11% с валидацией QR-кода.",
      intake_title: "Мобильная и Пакетная Загрузка",
      intake_desc: "Финансовая команда перетаскивает файлы или фотографирует чеки со смартфона. CFO AI считывает документ и готовит его к сверке за секунды.",
      review_title: "Двухоконная Верификация",
      review_desc: "Строки с высокой уверенностью распознавания подтверждаются в один клик. Спорный рукописный текст подсвечивается для проверки человеком."
    },
    tax_page: {
      badge: "НАЛОГОВЫЙ РАДАР",
      heading: "Налоги Индонезии и Готовность к CoreTax",
      subheading: "Будьте готовы к срокам PPh 21 TER, PPh 23, PPN 11% и переходу на систему CoreTax (PMK 81/2024) с автоматическими расчетами.",
      pph21_title: "Модуль PPh 21 TER",
      pph21_desc: "Автоматический расчет удержаний с зарплаты по средним эффективным ставкам (категории TER A, B, C) согласно PP 58/2023 и PMK 168/2023.",
      pph23_title: "Удержания PPh 23 и PPh 4(2)",
      pph23_desc: "Учет 2% налога у источника при оплате услуг и финального налога на аренду помещений с формированием сводок Bukti Potong к концу месяца.",
      ppn_title: "Сверка НДС (PPN 11%)",
      ppn_desc: "Перекрестная сверка исходящего НДС (Pajak Keluaran) и входящего (Pajak Masukan) для точного расчета налога к уплате до конца отчетного периода."
    },
    pricing_page: {
      badge: "ПРОЗРАЧНЫЕ ТАРИФЫ",
      heading: "Простые и прозрачные тарифные планы",
      subheading: "Спроектировано для индонезийских компаний PT и PT PMA. Никаких скрытых платежей за настройку. 7 дней бесплатного теста на всех тарифах.",
      monthly_btn: "Ежемесячная оплата",
      annual_btn: "Оплата за год",
      discount_badge: "СКИДКА -20%",
      per_month: "/ месяц (USD)",
      trial_badge: "7 дней бесплатно",
      limits_title: "Подробные операционные лимиты",
      limits_sub: "Каждый лимит строго зафиксирован без скрытых штрафов за перерасход.",
      features_title: "Сравнительная матрица функционала",
      features_sub: "Полное распределение возможностей между тарифами Starter, Control и Pro.",
      custom_enterprise_title: "Нужна кастомная корпоративная конфигурация?",
      custom_enterprise_desc: "Для холдингов с более чем 5 юридическими лицами в Индонезии или интеграции со сложными ERP-системами CoreTax.",
      custom_enterprise_btn: "Связаться с Enterprise отделом",
      cat_financial_core: "Финансовое ядро",
      cat_operations: "Операции и контроль расходов",
      cat_ai_automation: "ИИ и автоматизация",
      cat_tax_compliance: "Налоги и комплаенс",
      cat_team_organization: "Команда и структура",
      cat_integrations_usage: "Интеграции и платформа"
    },
    cta_section: {
      heading: "Готовы взять финансы бизнеса под полный контроль?",
      subheading: "Управляйте ликвидностью, автоматизируйте банковскую сверку и соблюдайте налоги вместе с CFO AI.",
      note: "7 дней бесплатно • Банковская карта не требуется • Мгновенный запуск"
    },
    about_page: {
      badge: "НАША МИССИЯ",
      heading: "Финансовый контроль и уверенность для бизнеса в Индонезии",
      subheading: "CFO AI создан, чтобы избавить предпринимателей от хаоса разрозненных таблиц, задержек в отчетности и штрафов за несоблюдение индонезийских законов.",
      footprint_title: "Операционная деятельность и присутствие",
      footprint_p1: "Ведение бизнеса через форму PT или иностранную PT PMA в Индонезии имеет свои вызовы: мультивалютность, специфические налоги у источника (PPh 21 TER, PPh 23, PPh 4(2)), строгая система e-Faktur и масштабный переход страны на систему CoreTax DJP.",
      footprint_p2: "Команда CFO AI работает непосредственно в Джакарте и на Бали. Платформа создана с учетом форматов индонезийских банков и официальных стандартов бухучета без необходимости привлекать дорогой консалтинг.",
      security_title: "Безопасность данных и счетов",
      security_desc: "Банковское шифрование AES-256 в покое и TLS 1.3 при передаче. Базы данных клиентов строго изолированы. Мы никогда не продаем и не передаем финансовую информацию клиентов.",
      privacy_title: "Соответствие закону UU PDP",
      privacy_desc: "Полное соблюдение Закона Индонезии о защите персональных данных (UU No. 27/2022). Данные бухгалтерского учета клиентов никогда не используются для обучения публичных моделей ИИ."
    },
    footer: {
      about_text: "Финансовая ОС на базе ИИ для индонезийских компаний PT и PT PMA. Контроль денежных потоков, OCR счетов и автосверка выписок.",
      app_link: "app.cfo-ai.site",
      footprint: "Джакарта • Бали (Денпасар) • Работаем по всей Индонезии",
      col_platform: "Платформа",
      col_hub: "База Знаний",
      col_legal: "О компании и законы",
      copyright: "© 2026 CFO AI Indonesia. Все права защищены.",
      disclaimer: "CFO AI является операционной финансовой системой. Сервис не выдает официальных аудиторских заключений и не заменяет лицензированного Konsultan Pajak.",
      link_overview: "Обзор платформы",
      link_features: "Функции продукта",
      link_contact: "Контакты и запросы",
      link_privacy: "Политика конфиденциальности (UU PDP)",
      link_terms: "Условия обслуживания",
      link_tax_guides: "Гайд по налогам PT PMA 2026",
      link_pph21: "Формулы PPh 21 TER",
      link_coretax: "Переход на CoreTax DJP",
      back_to_top: "Наверх"
    },
    lightbox: {
      authentic_badge: "РЕАЛЬНЫЙ ИНТЕРФЕЙС V2",
      zoom_btn: "Увеличить (1.5x)",
      zoom_reset: "Сбросить (1x)"
    }
  }
};

module.exports = translations;
