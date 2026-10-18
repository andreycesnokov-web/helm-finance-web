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
          desc: "Multi-channel intake (web upload and mobile), AI vision extraction of vendor names, DPP, and applicable taxes with human review drawer.",
          link: "Review workflow"
        },
        {
          num: "03",
          title: "Indonesian Tax Radar",
          desc: "Indonesian statutory calendar monitoring, PPh 21 TER formulas, PPh 23, applicable VAT, and CoreTax PMK 81/2024 compliance advisories.",
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
          desc: "Upload photos of receipts or PDF tax invoices. OCR extracts DPP, applicable taxes, and vendor details for review and matching against imported bank statement rows.",
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
      badge: "FINANCIAL OPERATING SYSTEM",
      heading: "Run Your Business Finances in One Place.",
      subheading: "Manage expenses, invoices, approvals, and financial decisions in one connected workspace. Know what's confirmed, what's expected, and what needs your attention.",
      connected_workspace: {
        eyebrow: "CONNECTED FINANCIAL WORKSPACE",
        heading: "Your Financial Data. One Intelligent System.",
        subheading: "Connect your team, documents, and AI assistants to a unified financial workspace.",
        footnote: "Operational architecture overview. All financial disbursements, accounting modifications, and tax filings require authenticated user authorization and company-defined controls.",
        transition: "However your financial information enters CFO AI, it becomes part of connected, controlled financial workflows.",
        ui: {
          level_1_badge: "LEVEL 1",
          level_1_title: "Input & Interaction Channels",
          level_1_hint: "Click any channel to inspect pipeline and governance",
          inspect_flow: "Inspect flow",
          connector_1: "Secure Ingestion & API Integration",
          level_2_badge: "LEVEL 2 • CENTRAL CORE",
          level_2_pill: "AI Suggests • User Confirms",
          level_2_status: "Centralized Validation Core",
          inspector_badge: "ACTIVE CHANNEL INSPECTOR",
          inspector_col1: "Business Scenario",
          inspector_col2: "End-to-End Pipeline",
          inspector_col3: "Governance & Controls",
          connector_2: "Verified Ledger Posting & Tenant Isolation",
          level_3_badge: "LEVEL 3",
          transition_badge: "END-TO-END FLOW ARCHITECTURE",
          transition_cta: "Explore the 3 end-to-end workflows below",
          connected_steps: "4 Connected Steps"
        },
        channels: [
          {
            id: "whatsapp",
            name: "WhatsApp",
            subtitle: "Messaging & Receipt Intake",
            status: "Available",
            status_type: "available",
            example: "Send a receipt or invoice directly from a conversation.",
            description: "Team members submit receipts and vendor invoices via chat. Ingested documents enter the central queue for OCR processing, human review, and policy-based approval.",
            flow_desc: "Direct photo capture -> Central intake queue -> Human review & approval"
          },
          {
            id: "telegram",
            name: "Telegram",
            subtitle: "Summaries & Approvals",
            status: "Available",
            status_type: "available",
            example: "Ask for today's cash runway or approve a pending vendor bill.",
            description: "Authorized managers review pending expenses, approve disbursements with one tap, and query runway metrics directly in chat with full cryptographic audit logs.",
            flow_desc: "Runway & balance queries -> Pending approval alert -> Authenticated one-tap action"
          },
          {
            id: "chatgpt",
            name: "ChatGPT",
            subtitle: "Conversational Financial Queries",
            status: "Available",
            status_type: "available",
            example: "Ask about cash flow, outstanding invoices, expenses, and financial performance using your preferred AI assistant.",
            description: "Connect ChatGPT via Model Context Protocol (MCP) to query confirmed balances, outstanding receivables, and expense breakdowns with company-governed access.",
            flow_desc: "Governed MCP connection -> Natural language query -> Company-scoped read analysis"
          },
          {
            id: "claude",
            name: "Claude",
            subtitle: "Financial Analysis & Synthesis",
            status: "Available",
            status_type: "available",
            example: "Analyze burn rate trends and summarize vendor spending this quarter.",
            description: "Use Claude with MCP integration for deep financial synthesis, voucher citations, and runway scenario planning governed by authenticated read permissions.",
            flow_desc: "MCP session handshake -> Financial synthesis prompt -> Governed context & voucher citation"
          },
          {
            id: "webapp",
            name: "CFO AI Web App",
            subtitle: "Operations & Verification Workbench",
            status: "Available",
            status_type: "available",
            example: "Upload vendor invoices, review AI extraction, match bank feeds, and authorize entries.",
            description: "The primary control center for financial operations. Review incoming documents side-by-side with OCR extraction, verify bank suggestions, and approve ledger postings.",
            flow_desc: "Multi-format document upload -> Side-by-side human verification -> Approved posting & reconciliation"
          }
        ],
        intelligence_engine: {
          badge: "CFO AI FINANCIAL INTELLIGENCE",
          title: "CFO AI — Financial Intelligence",
          subtitle: "All channels connect to one central processing engine",
          capabilities: [
            {
              title: "Document Intelligence",
              desc: "Multimodal OCR extracts vendor, date, DPP, and applicable Indonesian tax data"
            },
            {
              title: "Data Validation & Human Review",
              desc: "Human-in-the-loop workbench: AI suggests, user confirms"
            },
            {
              title: "Approvals & Financial Workflows",
              desc: "Threshold-based routing and strict segregation of duties"
            },
            {
              title: "Reconciliation & Financial Insights",
              desc: "Multi-signal bank matching and 30/60/90-day predictive cash radar"
            }
          ]
        },
        workspace_destinations: {
          badge: "UNIFIED FINANCIAL WORKSPACE",
          title: "Authorized Information Flows Into One Operating Environment",
          subtitle: "Verified operational records populate dedicated business domains",
          items: [
            { name: "Transactions", desc: "Reconciled bank records & feeds", tag: "Bank & Cash Feeds" },
            { name: "Documents", desc: "Digital receipts, invoices & proofs", tag: "Digital Archive" },
            { name: "Invoices & Bills", desc: "Receivables aging & payable queue", tag: "AR & AP Ledger" },
            { name: "Approvals", desc: "Decision trail & limits", tag: "Authorization History" },
            { name: "Financial Reports", desc: "Balanced P&L & tax schedules", tag: "Financial Statements" },
            { name: "Audit Trail", desc: "Activity logs & compliance history", tag: "Activity Logs" }
          ]
        }
      },
      how_it_works_badge: "END-TO-END BUSINESS WORKFLOWS",
      how_it_works_heading: "One Financial System. From Action to Decision.",
      how_it_works_subheading: "See how CFO AI connects everyday financial activities with the information business owners need to stay in control.",
      workflows: [
        {
          id: "wf-expense",
          num: "01",
          badge: "EXPENSE TO LEDGER",
          title: "From Employee Expense to Approved Record",
          desc: "Eliminate lost receipts and delayed claims with structured intake, policy-based approvals, and audit-ready bookkeeping.",
          steps: [
            {
              step: "01",
              label: "Voucher Intake",
              title: "Receipt & Invoice Submission",
              desc: "Employees or vendors submit receipts and PDF invoices through chat, web upload, or email forwarding.",
              tag: "Submitted",
              tag_type: "submitted"
            },
            {
              step: "02",
              label: "AI Extraction",
              title: "Intelligent Data Parsing",
              desc: "OCR extracts vendor, date, currency, line items, and applicable tax fields into a pending review queue.",
              tag: "AI Extracted",
              tag_type: "assist"
            },
            {
              step: "03",
              label: "Human Review",
              title: "Verification & Discrepancy Check",
              desc: "Finance team reviews extracted data side-by-side with the original voucher before authorization.",
              tag: "Reviewed",
              tag_type: "reviewed"
            },
            {
              step: "04",
              label: "Approval & Posting",
              title: "Manager Approval & Ledger Entry",
              desc: "Authorized managers approve disbursements according to company policy, creating audit-ready accounting records.",
              tag: "Authorized",
              tag_type: "authorized"
            }
          ]
        },
        {
          id: "wf-invoice",
          num: "02",
          badge: "INVOICE TO SETTLEMENT",
          title: "From Customer Invoice to Collected Payment",
          desc: "Accelerate cash collection with compliant multi-currency invoicing, aging radar, follow-up alerts, and suggested bank matching.",
          steps: [
            {
              step: "01",
              label: "Invoice Issuance",
              title: "Compliant Billing & DPP/Tax",
              desc: "Issue multi-currency invoices with required Indonesian Rupiah equivalents and specified payment terms.",
              tag: "Issued",
              tag_type: "issued"
            },
            {
              step: "02",
              label: "Receivables Tracking",
              title: "Real-Time Aging & Overdue Monitoring",
              desc: "Track open balances across 30, 60, and 90-day aging buckets with timely follow-up alerts.",
              tag: "Tracked",
              tag_type: "tracked"
            },
            {
              step: "03",
              label: "Deposit Matching",
              title: "Intelligent Match Suggestions",
              desc: "Incoming bank statement lines suggest matching invoices based on amount, invoice reference, and counterparty.",
              tag: "Suggested Match",
              tag_type: "assist"
            },
            {
              step: "04",
              label: "Settlement Confirmation",
              title: "Confirmed Match & Receivable Close",
              desc: "Finance operator confirms verified bank matches, updating receivable balances and closing open items.",
              tag: "Settled",
              tag_type: "settled"
            }
          ]
        },
        {
          id: "wf-decision",
          num: "03",
          badge: "DATA TO STRATEGY",
          title: "Reliable Financial Data. Better Decisions.",
          desc: "CFO AI brings together confirmed financial transactions, banking data, receivables, payables, and known financial obligations to support reporting and forecasting. Unconfirmed transactions, expected payments, and missing information are identified separately, helping business owners understand the reliability of their financial picture.",
          steps: [
            {
              step: "01",
              label: "Consolidated Data",
              title: "Unified Financial Records",
              desc: "Brings together confirmed transactions, banking feeds, open receivables, payables, and known financial commitments.",
              tag: "Aggregated",
              tag_type: "aggregated"
            },
            {
              step: "02",
              label: "Reliability Check",
              title: "Confirmed vs. Expected Separation",
              desc: "Distinguishes verified historical records from pending drafts and unconfirmed entries to ensure reporting integrity.",
              tag: "Separated",
              tag_type: "separated"
            },
            {
              step: "03",
              label: "Forward Trajectory",
              title: "30-60-90 Day Cash Horizon",
              desc: "Models upcoming operational cash commitments, expected collections, and tax obligations across forward horizons.",
              tag: "Projected",
              tag_type: "projected"
            },
            {
              step: "04",
              label: "Executive Action",
              title: "Informed Strategic Decisions",
              desc: "Financial insights connect directly to underlying transaction records, supporting sound leadership decisions.",
              tag: "Actionable",
              tag_type: "actionable"
            }
          ]
        }
      ],
      primary_heading: "Core Operational Cockpit",
      primary_subheading: "Full uncropped visibility into liquidity, cash runway, and transaction streams.",
      secondary_heading: "Extended Management & Regulatory Modules",
      secondary_subheading: "Click any preview to inspect the full interface in high resolution.",
      click_to_enlarge: "Click to enlarge full preview",
      authentic_tag: "V2 AUTHENTIC SCREEN",
      modules: {
        pulse: {
          title: "Pulse Command Center",
          desc: "Executive liquidity cockpit showing real-time multi-currency cash balances across BCA, Mandiri, and operational accounts with dynamic runway estimates."
        },
        radar: {
          title: "Radar Runway Forecast",
          desc: "Forward-looking 30, 60, and 90-day cash trajectory simulation. Adjust revenue collection delays, statutory tax payments, and hiring runway impact."
        },
        accounts: {
          title: "Multi-Currency Treasury Accounts",
          desc: "Centralized overview of domestic IDR accounts and foreign currency holdings with real-time Bank Indonesia exchange rate tracking."
        },
        transactions: {
          title: "Operational Transaction Feed",
          desc: "Searchable transaction ledger with real-time balance tracking, tax invoice (Faktur Pajak) attachment links, and counterparty categorization."
        },
        bank_import: {
          title: "Bank Statement Import & Review",
          desc: "Direct import of BCA, Mandiri, and generic MT940/CSV statements with intelligent transaction deduplication and side-by-side reconciliation."
        },
        invoicing: {
          title: "Multi-Currency Invoicing",
          desc: "Compliant commercial invoices with mandatory Indonesian Rupiah (IDR) statutory equivalents, tax calculations, and payment tracking."
        },
        bills: {
          title: "Accounts Payable & Bills",
          desc: "Vendor bill management with approval thresholds, duplicate detection, payment scheduling, and applicable withholding tax tracking."
        },
        approvals: {
          title: "Disbursement Approval Queue",
          desc: "Configurable approval workflows enforcing internal controls on expenses and vendor payments exceeding authorized management thresholds."
        },
        doc_intelligence: {
          title: "Document Intelligence & OCR",
          desc: "Multimodal AI vision extraction for Indonesian tax invoices (Faktur Pajak) and receipts. Extracts vendor name, DPP, and applicable Indonesian VAT and withholding taxes."
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
          desc: "Continuous statutory calendar monitoring for PPh 21 TER, PPh 23, PPh 4(2), and applicable VAT. Helps businesses monitor deadlines, prepare supporting documents, and reduce the risk of missed obligations and reporting errors."
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
      faktur_desc: "Parses DGT standard tax invoices, extracting Nomor Seri Faktur Pajak (NSFP), NPWP, DPP, and applicable VAT with QR validation.",
      intake_title: "Mobile & Drag-and-Drop Intake",
      intake_desc: "Finance teams upload PDFs or snap photos of receipts on mobile. CFO AI ingests the image and stages it for review within seconds.",
      review_title: "Human-in-the-Loop Verification",
      review_desc: "High-confidence extractions are flagged for quick one-click confirmation. Ambiguous handwriting is highlighted for operator review."
    },
    tax_page: {
      badge: "STATUTORY RADAR",
      heading: "Indonesian Tax & CoreTax Radar",
      subheading: "Stay ahead of PPh 21 TER, PPh 23, applicable VAT, and PMK 81/2024 CoreTax transition deadlines with automated calculation worksheets.",
      pph21_title: "PPh 21 TER Engine",
      pph21_desc: "Automatically calculates monthly employee withholding using Tarif Efektif Rata-Rata (TER Categories A, B, C) per PP 58/2023 and PMK 168/2023.",
      pph23_title: "PPh 23 & PPh 4(2) Withholding",
      pph23_desc: "Tracks 2% service withholding and final tax on commercial property leases, auto-generating Bukti Potong summaries for month-end filing.",
      ppn_title: "Indonesian VAT Reconciliation",
      ppn_desc: "Cross-checks Pajak Keluaran (output VAT) against Pajak Masukan (input VAT) under applicable tax rates to ensure accurate net tax calculation before filing deadlines."
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
      about_text: "CFO AI helps Indonesian businesses manage finances, documents, and tax readiness in one platform.",
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
          desc: "Pemasukan multi-kanal (web dan mobile), ekstraksi AI visi untuk nama vendor, DPP, dan pajak yang berlaku dengan laci verifikasi manusia.",
          link: "Tinjau alur kerja"
        },
        {
          num: "03",
          title: "Radar Kepatuhan Pajak",
          desc: "Pemantauan kalender resmi pajak, formula PPh 21 TER, PPh 23, PPN yang berlaku, dan notifikasi kepatuhan CoreTax PMK 81/2024.",
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
          desc: "Unggah foto kuitansi atau faktur pajak PDF. OCR mengekstrak DPP, pajak yang berlaku, dan rincian vendor untuk ditinjau dan dicocokkan dengan mutasi bank yang diimpor.",
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
      badge: "SISTEM OPERASI KEUANGAN",
      heading: "Kelola Keuangan Bisnis Anda di Satu Tempat.",
      subheading: "Kelola pengeluaran, faktur, persetujuan, dan keputusan keuangan dalam satu ruang kerja terpadu. Ketahui apa yang sudah terkonfirmasi, apa yang diperkirakan, dan apa yang memerlukan perhatian Anda.",
      connected_workspace: {
        eyebrow: "RUANG KERJA KEUANGAN TERPADU",
        heading: "Data Keuangan Anda. Satu Sistem Cerdas.",
        subheading: "Hubungkan tim, dokumen, dan asisten AI Anda ke dalam satu ruang kerja keuangan terintegrasi.",
        footnote: "Gambaran arsitektur operasional. Seluruh pengeluaran keuangan, perubahan pembukuan, dan pelaporan pajak memerlukan otorisasi pengguna terotentikasi dan kontrol internal perusahaan.",
        transition: "Bagaimanapun data keuangan Anda masuk ke CFO AI, seluruhnya menjadi bagian dari alur kerja keuangan yang terhubung dan terkendali.",
        ui: {
          level_1_badge: "TINGKAT 1",
          level_1_title: "Kanal Input & Interaksi",
          level_1_hint: "Klik kanal mana saja untuk melihat alur dan tata kelola",
          inspect_flow: "Lihat alur",
          connector_1: "Penerimaan Aman & Integrasi API",
          level_2_badge: "TINGKAT 2 • INTI PUSAT",
          level_2_pill: "AI Menyarankan • Pengguna Mengonfirmasi",
          level_2_status: "Inti Validasi Terpusat",
          inspector_badge: "INSPEKTUR KANAL AKTIF",
          inspector_col1: "Skenario Bisnis",
          inspector_col2: "Alur Kerja Menyeluruh",
          inspector_col3: "Tata Kelola & Kontrol",
          connector_2: "Pembukuan Terverifikasi & Isolasi Data Perusahaan",
          level_3_badge: "TINGKAT 3",
          transition_badge: "ARSITEKTUR ALUR TERPADU",
          transition_cta: "Jelajahi 3 alur kerja menyeluruh di bawah ini",
          connected_steps: "4 Langkah Terhubung"
        },
        channels: [
          {
            id: "whatsapp",
            name: "WhatsApp",
            subtitle: "Pesan & Pengiriman Bukti",
            status: "Tersedia",
            status_type: "available",
            example: "Kirim kuitansi atau faktur langsung dari percakapan.",
            description: "Anggota tim mengirim kuitansi dan faktur vendor melalui chat. Dokumen masuk ke antrean pusat untuk pemrosesan OCR, tinjauan manusia, dan persetujuan berbasis kebijakan.",
            flow_desc: "Pengambilan foto langsung -> Antrean penerimaan pusat -> Tinjauan manusia & persetujuan"
          },
          {
            id: "telegram",
            name: "Telegram",
            subtitle: "Ringkasan & Persetujuan",
            status: "Tersedia",
            status_type: "available",
            example: "Tanyakan runway kas hari ini atau setujui tagihan vendor yang tertunda.",
            description: "Manajer berwenang meninjau pengeluaran tertunda, menyetujui pembayaran dengan satu ketukan, dan menanyakan metrik runway langsung di chat dengan jejak audit kriptografis.",
            flow_desc: "Kueri saldo & runway -> Notifikasi persetujuan tertunda -> Tindakan terotentikasi"
          },
          {
            id: "chatgpt",
            name: "ChatGPT",
            subtitle: "Kueri Keuangan Percakapan",
            status: "Tersedia",
            status_type: "available",
            example: "Tanyakan arus kas, faktur tertunggak, pengeluaran, dan kinerja keuangan menggunakan asisten AI pilihan Anda.",
            description: "Hubungkan ChatGPT melalui Model Context Protocol (MCP) untuk menanyakan saldo terkonfirmasi, piutang tertunggak, dan rincian biaya dengan izin kelola perusahaan.",
            flow_desc: "Koneksi MCP terkendali -> Kueri bahasa alami -> Analisis baca berizin perusahaan"
          },
          {
            id: "claude",
            name: "Claude",
            subtitle: "Analisis & Sintesis Keuangan",
            status: "Tersedia",
            status_type: "available",
            example: "Analisis tren burn rate dan rangkum pengeluaran vendor kuartal ini.",
            description: "Gunakan Claude dengan integrasi MCP untuk sintesis keuangan mendalam, sitasi bukti transaksi, dan perencanaan skenario kas dengan hak akses baca terverifikasi.",
            flow_desc: "Handshake sesi MCP -> Perintah analisis keuangan -> Konteks teratur & sitasi dokumen"
          },
          {
            id: "webapp",
            name: "CFO AI Web App",
            subtitle: "Meja Kerja Operasi & Verifikasi",
            status: "Tersedia",
            status_type: "available",
            example: "Unggah faktur vendor, tinjau ekstraksi AI, cocokkan mutasi bank, dan otorisasi entri.",
            description: "Pusat kendali utama operasi keuangan. Tinjau dokumen bersama hasil ekstraksi OCR, verifikasi saran mutasi bank, dan setujui pembukuan buku besar.",
            flow_desc: "Unggah dokumen multi-format -> Verifikasi berdampingan oleh manusia -> Pembukuan & rekonsiliasi disetujui"
          }
        ],
        intelligence_engine: {
          badge: "INTELIGENSI KEUANGAN CFO AI",
          title: "CFO AI — Inteligensi Keuangan",
          subtitle: "Seluruh kanal terhubung ke satu mesin pemrosesan pusat",
          capabilities: [
            {
              title: "Inteligensi Dokumen",
              desc: "OCR multimodal membaca vendor, tanggal, DPP, dan pajak Indonesia yang berlaku"
            },
            {
              title: "Validasi Data & Verifikasi Manusia",
              desc: "Meja kerja kendali manusia: AI menyarankan, pengguna mengonfirmasi"
            },
            {
              title: "Persetujuan & Alur Kerja Keuangan",
              desc: "Perutean berbasis ambang batas dan pemisahan tugas yang ketat"
            },
            {
              title: "Rekonsiliasi & Wawasan Finansial",
              desc: "Pencocokan mutasi bank multi-sinyal dan radar prediksi kas 30/60/90 hari"
            }
          ]
        },
        workspace_destinations: {
          badge: "RUANG KERJA KEUANGAN TERPADU",
          title: "Informasi Terotorisasi Mengalir ke Satu Lingkungan Operasional",
          subtitle: "Catatan operasional terverifikasi mengisi domain bisnis khusus",
          items: [
            { name: "Transaksi", desc: "Mutasi & saldo rekening bank", tag: "Mutasi Bank & Kas" },
            { name: "Dokumen", desc: "Kuitansi digital, faktur & bukti", tag: "Arsip Digital" },
            { name: "Faktur & Tagihan", desc: "Umur piutang & antrean bayar", tag: "Buku Piutang & Hutang" },
            { name: "Persetujuan", desc: "Jejak keputusan & batasan", tag: "Riwayat Otorisasi" },
            { name: "Laporan Keuangan", desc: "Laba rugi & jadwal pajak", tag: "Laporan Keuangan" },
            { name: "Jejak Audit", desc: "Log aktivitas & kepatuhan", tag: "Log Aktivitas" }
          ]
        }
      },
      how_it_works_badge: "ALUR KERJA BISNIS TERPADU",
      how_it_works_heading: "Satu Sistem Keuangan. Dari Tindakan hingga Keputusan.",
      how_it_works_subheading: "Ketahui bagaimana CFO AI menghubungkan aktivitas keuangan harian dengan informasi yang dibutuhkan pemilik bisnis untuk tetap memegang kendali.",
      workflows: [
        {
          id: "wf-expense",
          num: "01",
          badge: "PENGELUARAN KE BUKU BESAR",
          title: "Dari Pengeluaran Staf hingga Catatan Terverifikasi",
          desc: "Hilangkan bukti pembayaran yang hilang dan klaim tertunda dengan penerimaan terstruktur, persetujuan berbasis kebijakan, dan pembukuan siap audit.",
          steps: [
            {
              step: "01",
              label: "Penerimaan Bukti",
              title: "Pengiriman Kuitansi & Faktur",
              desc: "Karyawan atau vendor mengirimkan kuitansi dan faktur PDF melalui chat, unggahan web, atau penerusan email.",
              tag: "Terkirim",
              tag_type: "submitted"
            },
            {
              step: "02",
              label: "Ekstraksi AI",
              title: "Pembacaan Data Cerdas",
              desc: "OCR mengekstrak data vendor, tanggal, nilai, dan pajak yang berlaku ke dalam antrean tinjauan tertunda.",
              tag: "Ekstraksi AI",
              tag_type: "assist"
            },
            {
              step: "03",
              label: "Verifikasi Manusia",
              title: "Tinjauan & Pemeriksaan Selisih",
              desc: "Tim keuangan meninjau data hasil ekstraksi berdampingan dengan dokumen asli sebelum otorisasi.",
              tag: "Ditinjau",
              tag_type: "reviewed"
            },
            {
              step: "04",
              label: "Persetujuan & Pembukuan",
              title: "Otorisasi Manajer & Entri Buku Besar",
              desc: "Manajer berwenang menyetujui pengeluaran sesuai batas wewenang perusahaan, menghasilkan catatan akuntansi siap audit.",
              tag: "Diotorisasi",
              tag_type: "authorized"
            }
          ]
        },
        {
          id: "wf-invoice",
          num: "02",
          badge: "FAKTUR KE PELUNASAN",
          title: "Dari Faktur Pelanggan hingga Penerimaan Dana",
          desc: "Percepat penagihan kas dengan faktur multi-valuta resmi, radar umur piutang, peringatan tindak lanjut, dan saran pencocokan mutasi bank.",
          steps: [
            {
              step: "01",
              label: "Penerbitan Faktur",
              title: "Penagihan Resmi & DPP/Pajak",
              desc: "Terbitkan faktur penjualan multi-valuta dengan ekuivalen Rupiah (IDR) wajib serta syarat pembayaran yang ditentukan.",
              tag: "Diterbitkan",
              tag_type: "issued"
            },
            {
              step: "02",
              label: "Pelacakan Piutang",
              title: "Pemantauan Umur & Jatuh Tempo Real-Time",
              desc: "Lacak saldo tagihan terbuka dalam kelompok 30, 60, dan 90 hari dengan peringatan tindak lanjut tepat waktu.",
              tag: "Dilacak",
              tag_type: "tracked"
            },
            {
              step: "03",
              label: "Pencocokan Setoran",
              title: "Saran Pencocokan Cerdas",
              desc: "Mutasi kredit rekening koran menyarankan faktur yang cocok berdasarkan jumlah uang, nomor referensi, dan pihak lawan.",
              tag: "Saran Cocok",
              tag_type: "assist"
            },
            {
              step: "04",
              label: "Konfirmasi Pelunasan",
              title: "Pencocokan Terverifikasi & Penutupan Piutang",
              desc: "Operator keuangan mengonfirmasi kecocokan mutasi bank yang terverifikasi, memperbarui saldo piutang dan menutup tagihan.",
              tag: "Lunas",
              tag_type: "settled"
            }
          ]
        },
        {
          id: "wf-decision",
          num: "03",
          badge: "DATA KE STRATEGI",
          title: "Data Keuangan Andal. Keputusan Lebih Baik.",
          desc: "CFO AI menyatukan transaksi keuangan terkonfirmasi, data perbankan, piutang, hutang, dan kewajiban keuangan yang diketahui untuk mendukung pelaporan dan prakiraan. Transaksi yang belum terkonfirmasi, pembayaran yang diperkirakan, dan informasi yang belum lengkap dipisahkan secara jelas, membantu pemilik bisnis memahami keandalan gambaran keuangan mereka.",
          steps: [
            {
              step: "01",
              label: "Konsolidasi Data",
              title: "Catatan Keuangan Terpadu",
              desc: "Menyatukan transaksi terkonfirmasi, mutasi bank, piutang terbuka, hutang, dan komitmen keuangan terdata.",
              tag: "Terkonsolidasi",
              tag_type: "aggregated"
            },
            {
              step: "02",
              label: "Pemeriksaan Keandalan",
              title: "Pemisahan Konfirmasi & Estimasi",
              desc: "Membedakan catatan historis terverifikasi dari draf tertunda dan entri belum terkonfirmasi demi integritas pelaporan.",
              tag: "Terpisah",
              tag_type: "separated"
            },
            {
              step: "03",
              label: "Horizon Kas",
              title: "Proyeksi Kas 30-60-90 Hari",
              desc: "Memodelkan komitmen kas operasional mendatang, perkiraan penerimaan, dan kewajiban pajak dalam cakrawala waktu ke depan.",
              tag: "Terproyeksi",
              tag_type: "projected"
            },
            {
              step: "04",
              label: "Tindakan Eksekutif",
              title: "Keputusan Strategis Terarah",
              desc: "Wawasan keuangan terhubung langsung ke catatan transaksi dasar, mendukung pengambilan keputusan pimpinan yang tepat.",
              tag: "Siap Dijalankan",
              tag_type: "actionable"
            }
          ]
        }
      ],
      primary_heading: "Kokpit Operasional Inti",
      primary_subheading: "Visibilitas penuh tanpa potongan gambar terhadap likuiditas, runway, dan mutasi transaksi.",
      secondary_heading: "Modul Manajemen & Regulasi Lanjutan",
      secondary_subheading: "Klik pratinjau mana pun untuk melihat antarmuka lengkap dalam resolusi tinggi.",
      click_to_enlarge: "Klik untuk memperbesar tampilan penuh",
      authentic_tag: "TAMPILAN NYATA V2",
      modules: {
        pulse: {
          title: "Pulse Command Center",
          desc: "Dasbor likuiditas eksekutif yang menampilkan saldo kas multi-valuta langsung dari rekening BCA, Mandiri, dan kas operasional beserta estimasi runway dinamis."
        },
        radar: {
          title: "Radar Proyeksi Runway",
          desc: "Simulasi trajektori kas 30, 60, dan 90 hari ke depan. Sesuaikan penundaan pembayaran pelanggan, pajak terutang, dan rencana rekrutmen tim."
        },
        accounts: {
          title: "Akun Kas & Treasury Multi-Valuta",
          desc: "Pusat kendali rekening giro domestik IDR dan saldo valuta asing dengan pembaruan kurs Bank Indonesia secara berkala."
        },
        transactions: {
          title: "Buku Mutasi Operasional",
          desc: "Buku besar transaksi yang dapat dicari dengan pelacakan saldo real-time, tautan lampiran Faktur Pajak, dan kategorisasi mitra bisnis."
        },
        bank_import: {
          title: "Impor Rekening Koran & Review",
          desc: "Impor langsung mutasi bank BCA, Mandiri, dan format MT940/CSV dengan deteksi duplikasi cerdas serta verifikasi rekonsiliasi berdampingan."
        },
        invoicing: {
          title: "Faktur Penjualan Multi-Valuta",
          desc: "Faktur komersial resmi dengan konversi Rupiah (IDR) wajib, penghitungan pajak terutang, dan pelacakan status pelunasan."
        },
        bills: {
          title: "Hutang Usaha & Tagihan Vendor",
          desc: "Manajemen tagihan vendor dengan batas persetujuan, deteksi duplikasi, penjadwalan pembayaran, dan pelacakan pemotongan pajak."
        },
        approvals: {
          title: "Antrean Persetujuan Pengeluaran",
          desc: "Alur kerja persetujuan berjenjang yang menegakkan kendali internal atas biaya operasional dan pembayaran vendor sesuai batas wewenang."
        },
        doc_intelligence: {
          title: "Inteligensi Dokumen & OCR",
          desc: "Ekstraksi AI visi multimodal untuk Faktur Pajak Indonesia dan kuitansi. Mengekstrak nama vendor, DPP, serta PPN dan PPh yang berlaku."
        },
        ai_cfo: {
          title: "AI Chief Financial Officer",
          desc: "Antarmuka percakapan bahasa alami untuk menjawab pertanyaan pembukuan (misal: 'Berapa burn rate marketing kuartal lalu?') dengan bukti voucher transaksi."
        },
        ai_accountant: {
          title: "Paket Kesiapan Akuntan",
          desc: "Ekspor satu klik paket arsip audit berisi CSV Buku Besar seimbang, log rekonsiliasi, jadwal pajak, dan dokumen pendukung."
        },
        compliance: {
          title: "Radar Kepatuhan Pajak Indonesia",
          desc: "Pemantauan kalender pajak berkelanjutan untuk PPh 21 TER, PPh 23, PPh 4(2), dan PPN yang berlaku. Membantu bisnis memantau tenggat waktu, menyiapkan dokumen pendukung, dan mengurangi risiko keterlambatan serta kesalahan pelaporan."
        },
        payroll: {
          title: "Mesin Penggajian & PPh 21 TER",
          desc: "Modul perhitungan gaji karyawan menggunakan tabel resmi TER Kategori A, B, dan C sesuai PP 58/2023 dan PMK 168/2023."
        },
        multi_company: {
          title: "Peralihan Ruang Kerja Multi-Entitas",
          desc: "Beralih secara instan antara entitas bisnis yang berbeda (operasi PT dan PT PMA). Setiap perusahaan memiliki buku besar terisolasi, rekening bank independen, dan hak akses khusus."
        }
      }
    },
    doc_page: {
      badge: "INTELIJEN DOKUMEN",
      heading: "Dari Kuitansi Kertas ke Buku Besar dalam Hitungan Detik",
      subheading: "Pangkas 80% entri data manual dengan OCR visi multimodal, verifikasi manusia, dan pencocokan otomatis ke rekening koran.",
      faktur_title: "Faktur Pajak & Pemindai QR",
      faktur_desc: "Mengekstrak faktur pajak standar DJP, membaca Nomor Seri Faktur Pajak (NSFP), NPWP, DPP, dan PPN yang berlaku dengan validasi QR.",
      intake_title: "Pemasukan Mobile & Unggah Berkas",
      intake_desc: "Tim keuangan mengunggah PDF atau memotret kuitansi dari ponsel. CFO AI memproses gambar dan menyiapkannya untuk ditinjau dalam hitungan detik.",
      review_title: "Verifikasi Berdampingan",
      review_desc: "Hasil ekstraksi tingkat keyakinan tinggi ditandai untuk konfirmasi cepat. Tulisan tangan yang kurang jelas disorot untuk peninjauan operator."
    },
    tax_page: {
      badge: "RADAR KEPATUHAN",
      heading: "Radar Pajak Indonesia & CoreTax",
      subheading: "Antisipasi tenggat waktu PPh 21 TER, PPh 23, PPN yang berlaku, dan transisi CoreTax PMK 81/2024 dengan lembar kerja perhitungan otomatis.",
      pph21_title: "Mesin PPh 21 TER",
      pph21_desc: "Menghitung pemotongan bulanan karyawan menggunakan Tarif Efektif Rata-Rata (TER Kategori A, B, C) sesuai PP 58/2023 dan PMK 168/2023.",
      pph23_title: "Pemotongan PPh 23 & PPh 4(2)",
      pph23_desc: "Melacak pemotongan 2% jasa dan pajak final sewa tempat usaha komersial, membuat rekap Bukti Potong untuk pelaporan bulanan.",
      ppn_title: "Rekonsiliasi PPN Indonesia",
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
      about_text: "CFO AI membantu bisnis Indonesia mengelola keuangan, dokumen, dan kesiapan pajak dalam satu platform.",
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
          desc: "Мультиканальная загрузка (веб и мобильная), компьютерное зрение для извлечения поставщика, базы DPP и применимых налогов с панелью верификации.",
          link: "Обзор процессов"
        },
        {
          num: "03",
          title: "Налоговый радар Индонезии",
          desc: "Мониторинг налогового календаря, формулы PPh 21 TER, налог у источника PPh 23, применимый НДС и подготовка к реформе CoreTax PMK 81/2024.",
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
      badge: "ФИНАНСОВАЯ ОПЕРАЦИОННАЯ СИСТЕМА",
      heading: "Управляйте финансами бизнеса в единой системе.",
      subheading: "Управляйте расходами, счетами, согласованиями и финансовыми решениями в единой рабочей среде. Контролируйте подтвержденные данные, ожидаемые платежи и зоны внимания.",
      connected_workspace: {
        eyebrow: "ЕДИНОЕ ФИНАНСОВОЕ ПРОСТРАНСТВО",
        heading: "Ваши финансовые данные. Единый интеллект.",
        subheading: "Подключите команду, первичные документы и AI-ассистентов к единой рабочей финансовой среде.",
        footnote: "Обзор операционной архитектуры. Все финансовые выплаты, проводки в главной книге и налоговые отчеты требуют авторизации уполномоченных сотрудников и корпоративного контроля.",
        transition: "Каким бы путем данные ни поступали в CFO AI, они становятся частью единого контролируемого финансового контура.",
        ui: {
          level_1_badge: "УРОВЕНЬ 1",
          level_1_title: "Каналы ввода и взаимодействия",
          level_1_hint: "Нажмите на канал для просмотра пайплайна и правил доступа",
          inspect_flow: "Смотреть пайплайн",
          connector_1: "Защищенный прием данных и API-интеграция",
          level_2_badge: "УРОВЕНЬ 2 • ЦЕНТРАЛЬНОЕ ЯДРО",
          level_2_pill: "ИИ предлагает • Человек подтверждает",
          level_2_status: "Централизованное ядро валидации",
          inspector_badge: "ИНСПЕКТОР АКТИВНОГО КАНАЛА",
          inspector_col1: "Бизнес-сценарий",
          inspector_col2: "Сквозной пайплайн",
          inspector_col3: "Контроль и безопасность",
          connector_2: "Авторизованные проводки и изоляция данных бизнеса",
          level_3_badge: "УРОВЕНЬ 3",
          transition_badge: "СКВОЗНАЯ АРХИТЕКТУРА ПРОЦЕССОВ",
          transition_cta: "Изучите 3 сквозных рабочих процесса ниже",
          connected_steps: "4 связанных шага"
        },
        channels: [
          {
            id: "whatsapp",
            name: "WhatsApp",
            subtitle: "Сообщения и отправка чеков",
            status: "Доступно",
            status_type: "available",
            example: "Отправляйте чеки или счета прямо из диалога.",
            description: "Сотрудники отправляют чеки и счета поставщиков через чат. Документы поступают в центральную очередь для оптического распознавания, проверки человеком и согласования.",
            flow_desc: "Фотосъемка чека -> Центральная очередь -> Проверка человеком и утверждение"
          },
          {
            id: "telegram",
            name: "Telegram",
            subtitle: "Сводки и согласования",
            status: "Доступно",
            status_type: "available",
            example: "Узнайте текущий запас денежных средств или согласуйте счет поставщика.",
            description: "Руководители просматривают ожидающие расходы, утверждают выплаты в одно касание и запрашивают показатели ликвидности в чате с полной фиксацией аудиторского следа.",
            flow_desc: "Запросы баланса и runway -> Уведомление о согласовании -> Авторизованное действие"
          },
          {
            id: "chatgpt",
            name: "ChatGPT",
            subtitle: "Финансовые диалоговые запросы",
            status: "Доступно",
            status_type: "available",
            example: "Задавайте вопросы о денежном потоке, неоплаченных счетах, расходах и финансовых результатах вашему ИИ-ассистенту.",
            description: "Подключайте ChatGPT через Model Context Protocol (MCP) для анализа подтвержденных остатков, дебиторской задолженности и расходов в рамках корпоративных прав доступа.",
            flow_desc: "Защищенное MCP-подключение -> Запрос на естественном языке -> Анализ данных по правам компании"
          },
          {
            id: "claude",
            name: "Claude",
            subtitle: "Финансовый анализ и синтез",
            status: "Доступно",
            status_type: "available",
            example: "Анализируйте динамику расходов и структурируйте затраты по поставщикам за квартал.",
            description: "Используйте Claude с интеграцией MCP для глубокого финансового анализа, ссылок на первичные документы и сценарного моделирования с разграничением прав доступа.",
            flow_desc: "Сессия MCP -> Аналитический запрос -> Контролируемый контекст со ссылками на первичку"
          },
          {
            id: "webapp",
            name: "CFO AI Web App",
            subtitle: "Рабочее место операций и верификации",
            status: "Доступно",
            status_type: "available",
            example: "Загружайте счета поставщиков, проверяйте распознавание, сопоставляйте банковские выписки и утверждайте проводки.",
            description: "Основной центр управления финансовыми операциями. Сопоставляйте оригиналы документов с распознанными данными, подтверждайте банковские матчинги и утверждайте записи.",
            flow_desc: "Загрузка любых документов -> Двусторонняя проверка человеком -> Утвержденная запись и сверка"
          }
        ],
        intelligence_engine: {
          badge: "ФИНАНСОВЫЙ ИНТЕЛЛЕКТ CFO AI",
          title: "CFO AI — Финансовый Интеллект",
          subtitle: "Все каналы подключены к единому вычислительному ядру",
          capabilities: [
            {
              title: "Интеллект документов",
              desc: "Мультимодальный OCR: считывание поставщика, даты, базы DPP и применимых налогов Индонезии"
            },
            {
              title: "Контроль данных и проверка человеком",
              desc: "Интерфейс под контролем человека: AI предлагает, специалист подтверждает"
            },
            {
              title: "Согласования и регламентные процессы",
              desc: "Маршрутизация по финансовым лимитам и строгое разграничение полномочий"
            },
            {
              title: "Сверка и финансовая аналитика",
              desc: "Многофакторное сопоставление выписок и радар прогноза ликвидности на 30/60/90 дней"
            }
          ]
        },
        workspace_destinations: {
          badge: "ЕДИНАЯ ОПЕРАЦИОННАЯ СРЕДА",
          title: "Авторизованные потоки данных сходятся в единой системе",
          subtitle: "Проверенные операционные записи распределяются по специализированным разделам",
          items: [
            { name: "Транзакции", desc: "Банковские записи и выписки", tag: "Банк и касса" },
            { name: "Документы", desc: "Цифровые чеки, счета и акты", tag: "Цифровой архив" },
            { name: "Счета и оплата", desc: "Старение дебиторки и кредиторка", tag: "Дебиторы и кредиторы" },
            { name: "Согласования", desc: "История решений и лимиты", tag: "История согласований" },
            { name: "Отчетность", desc: "Баланс, ОПУ и налоговые отчеты", tag: "Финансовая отчетность" },
            { name: "Журнал аудита", desc: "Логи действий и комплаенс", tag: "Журнал аудита" }
          ]
        }
      },
      how_it_works_badge: "СКВОЗНЫЕ БИЗНЕС-ПРОЦЕССЫ",
      how_it_works_heading: "Единая финансовая система. От действия к решению.",
      how_it_works_subheading: "Посмотрите, как CFO AI связывает повседневные финансовые операции с информацией, необходимой руководителю для полного контроля.",
      workflows: [
        {
          id: "wf-expense",
          num: "01",
          badge: "ОТ РАСХОДА ДО ПРОВОДКИ",
          title: "От Расхода Сотрудника до Проверенной Записи",
          desc: "Исключите утерю чеков и задержки в авансовых отчетах: структурированный прием, регламентные согласования и учет, готовый к проверкам.",
          steps: [
            {
              step: "01",
              label: "Прием чека",
              title: "Отправка чеков и счетов",
              desc: "Сотрудники или контрагенты отправляют квитанции и PDF-счета через чат, веб-форму или по электронной почте.",
              tag: "Отправлено",
              tag_type: "submitted"
            },
            {
              step: "02",
              label: "Распознавание AI",
              title: "Извлечение реквизитов",
              desc: "Система считывает поставщика, дату, валюту, позиции и применимые налоги в очередь предварительной проверки.",
              tag: "Распознано AI",
              tag_type: "assist"
            },
            {
              step: "03",
              label: "Проверка человеком",
              title: "Сверка и контроль расхождений",
              desc: "Финансовая служба проверяет распознанные данные бок о бок с оригиналом документа перед авторизацией.",
              tag: "Проверено",
              tag_type: "reviewed"
            },
            {
              step: "04",
              label: "Утверждение и проводка",
              title: "Согласование и запись в книгу",
              desc: "Уполномоченный руководитель утверждает выплату по правилам компании с формированием записи в главной книге.",
              tag: "Авторизовано",
              tag_type: "authorized"
            }
          ]
        },
        {
          id: "wf-invoice",
          num: "02",
          badge: "ОТ СЧЕТА ДО ОПЛАТЫ",
          title: "От Выставления Счета до Поступления Денег",
          desc: "Ускорение сбора выручки: официальные мультивалютные счета, радар задолженности, напоминания и интеллектуальный подбор соответствий.",
          steps: [
            {
              step: "01",
              label: "Выставление счета",
              title: "Официальный счет и налоги",
              desc: "Формирование счетов в любой валюте с обязательным рупийным эквивалентом (IDR) и согласованными условиями оплаты.",
              tag: "Выставлен",
              tag_type: "issued"
            },
            {
              step: "02",
              label: "Контроль дебиторки",
              title: "Мониторинг старения и сроков оплаты",
              desc: "Контроль открытых счетов по корзинам 30, 60 и 90 дней со своевременными напоминаниями о просрочке.",
              tag: "На контроле",
              tag_type: "tracked"
            },
            {
              step: "03",
              label: "Матчинг выписки",
              title: "Интеллектуальный подбор соответствий",
              desc: "Строки банковской выписки сопоставляются со счетами по сумме, назначению платежа и контрагенту в виде рекомендаций.",
              tag: "Предложен матч",
              tag_type: "assist"
            },
            {
              step: "04",
              label: "Подтверждение закрытия",
              title: "Подтвержденный расчет и погашение долга",
              desc: "Специалист подтверждает проверенное совпадение с банком, обновляя сальдо дебиторки и закрывая открытую позицию.",
              tag: "Погашено",
              tag_type: "settled"
            }
          ]
        },
        {
          id: "wf-decision",
          num: "03",
          badge: "ОТ ДАННЫХ К СТРАТЕГИИ",
          title: "Надежные финансовые данные. Взвешенные решения.",
          desc: "CFO AI объединяет подтвержденные финансовые операции, банковские выписки, дебиторскую и кредиторскую задолженность и зафиксированные обязательства для формирования отчетности и прогнозов. Неподтвержденные операции, ожидаемые поступления и недостающие сведения отражаются раздельно, позволяя руководителям объективно оценивать надежность картины бизнеса.",
          steps: [
            {
              step: "01",
              label: "Консолидация данных",
              title: "Единый финансовый контур",
              desc: "Сводит воедино подтвержденные операции, банковские выписки, дебиторку, кредиторку и зафиксированные обязательства.",
              tag: "Сведено",
              tag_type: "aggregated"
            },
            {
              step: "02",
              label: "Контроль надежности",
              title: "Разделение факта и прогноза",
              desc: "Отделяет верифицированные исторические записи от неподтвержденных черновиков и ожиданий ради достоверности отчетности.",
              tag: "Разделено",
              tag_type: "separated"
            },
            {
              step: "03",
              label: "Горизонт ликвидности",
              title: "Прогноз кассы на 30-60-90 дней",
              desc: "Моделирует предстоящие операционные расходы, ожидаемые сборы и налоговые обязательства на заданном горизонте.",
              tag: "Спрогнозировано",
              tag_type: "projected"
            },
            {
              step: "04",
              label: "Управленческое действие",
              title: "Обоснованные решения руководства",
              desc: "Финансовые выводы опираются на первичные записи, обеспечивая базу для уверенных стратегических решений.",
              tag: "Готово к действию",
              tag_type: "actionable"
            }
          ]
        }
      ],
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
          title: "Мультивалютные казначейские счета",
          desc: "Централизованный учет рупийных счетов IDR и валютных остатков с автоматическим обновлением курсов Банка Индонезии."
        },
        transactions: {
          title: "Операционный журнал транзакций",
          desc: "Детализированный реестр операций с контролем баланса в реальном времени, привязкой налоговых счетов Faktur Pajak и контрагентов."
        },
        bank_import: {
          title: "Импорт и сверка банковских выписок",
          desc: "Прямой импорт выписок BCA, Mandiri и файлов MT940/CSV с интеллектуальной дедупликацией и двусторонней сверкой."
        },
        invoicing: {
          title: "Мультивалютные счета клиентам",
          desc: "Официальные коммерческие счета с обязательным рупийным эквивалентом (IDR), расчетом налогов и отслеживанием статусов оплаты."
        },
        bills: {
          title: "Счета к оплате и кредиторка",
          desc: "Учет счетов поставщиков с порогами согласования, защитой от двойных выплат, графиком платежей и учетом налоговых удержаний."
        },
        approvals: {
          title: "Очередь согласования платежей",
          desc: "Настраиваемая маршрутизация согласований с контролем корпоративных лимитов на расходы и платежи контрагентам."
        },
        doc_intelligence: {
          title: "Интеллект документов и OCR",
          desc: "Зрительное распознавание налоговых счетов Faktur Pajak и чеков: считывание поставщика, базы DPP и применимых налогов Индонезии."
        },
        ai_cfo: {
          title: "AI Финансовый Директор",
          desc: "Диалоговый ИИ-ассистент: ответы на финансовые вопросы (например, 'Каковы расходы на маркетинг за прошлый квартал?') со ссылками на первичные ордера."
        },
        ai_accountant: {
          title: "Пакеты для бухгалтера и аудитора",
          desc: "Выгрузка в один клик полного архива для аудитора: главная книга в CSV, протоколы сверки, налоговые регистры и архив чеков."
        },
        compliance: {
          title: "Радар налогового соответствия",
          desc: "Непрерывный мониторинг сроков по PPh 21 TER, PPh 23, PPh 4(2) и применимому НДС. Помогает бизнесу отслеживать сроки, готовить первичные документы и снижать риск задержек и ошибок в отчетности."
        },
        payroll: {
          title: "Расчет зарплаты и PPh 21 TER",
          desc: "Модуль расчета оплаты труда персонала с государственными таблицами TER (категории A, B, C) согласно PP 58/2023 и PMK 168/2023."
        },
        multi_company: {
          title: "Переключение между юрлицами",
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
      subheading: "Будьте готовы к срокам PPh 21 TER, PPh 23, применимого НДС и переходу на систему CoreTax (PMK 81/2024) с автоматическими расчетами.",
      pph21_title: "Модуль PPh 21 TER",
      pph21_desc: "Автоматический расчет удержаний с зарплаты по средним эффективным ставкам (категории TER A, B, C) согласно PP 58/2023 и PMK 168/2023.",
      pph23_title: "Удержания PPh 23 и PPh 4(2)",
      pph23_desc: "Учет 2% налога у источника при оплате услуг и финального налога на аренду помещений с формированием сводок Bukti Potong к концу месяца.",
      ppn_title: "Сверка НДС (PPN)",
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
      about_text: "CFO AI помогает бизнесу в Индонезии управлять финансами, документами и налогами на единой платформе.",
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
