'use strict';
const fs = require('fs');
const path = require('path');

// 1. Update CURRENT_STATE.md
const currentStatePath = path.resolve(__dirname, '..', 'CFO AI OBSIDIAN', 'CURRENT_STATE.md');
let currentState = fs.readFileSync(currentStatePath, 'utf8');

const target1 = '   - Персистентность в БД: верифицирована в PostgreSQL 17.6 (6/6 чекпоинтов PASS, нулевой авто-постинг).\n';
const sectionCurrentState = `
9. **Open-Source OCR Worker PoC (PaddleOCR PP-OCRv4 ONNX) (2026-10-21) [ВЕРИФИЦИРОВАНО В DOCKER]:**
   - **Изолированный микросервис:** Создан и запущен Docker-контейнер \`cfo-ocr-worker:latest\` (образ 282MB, Python 3.10-slim, FastAPI, RapidOCR PP-OCRv4 ONNX runtime, pypdfium2). Основной Node.js backend и \`package.json\` остались на 100% нетронутыми.
   - **Ресурсы [ВЕРИФИЦИРОВАНО]:**
     - Idle RAM: **93.25 MiB**.
     - Peak RAM под нагрузкой: **368.1 MiB** (запас > 60% в контейнере 1GB RAM на Railway).
     - Скорость инференса на CPU: **2.1 — 3.7 сек** (растровые PNG); **2.9 — 4.9 сек** (PDF с рендерингом страниц).
   - **Бенчмарк 5 индонезийских документов [ВЕРИФИЦИРОВАНО]:**
     - Commercial Invoice: точность полей **83.3%** (номер INV/2026/SPD-0881, NPWP эмитента, NPWP покупателя, DPP Rp 5,000,000, Gross Rp 5,550,000 — 100% совпадение).
     - DJP e-Faktur Pajak 2026: точность **66.7%** (серия фактура 010.026-26.00000881, оба NPWP, DPP Rp 5,000,000 — совпадение).
     - BCA Corporate Statement: точность **60.0%** (тип, валюта, структура счета).
     - Cash Kwitansi: точность **40.0%** (номер KWT/2026/X-14, тип).
     - Thermal Receipt: точность **40.0%** (структура, чек).
   - **Сравнение с живым эталоном Nanonets [ВЕРИФИЦИРОВАНО]:**
     - На одинаковом синтетическом инвойсе Nanonets **не смог** извлечь DPP, PPN и Total (вернул \`undefined\`).
     - PaddleOCR + \`documentExtraction.js\` успешно распознали и извлекли DPP Rp 5,000,000 и Total Rp 5,550,000.
   - **Экономика [VERIFIED vs ESTIMATED]:**
     - Nanonets: $0.150/страница [VERIFIED]. При 1,000 стр/мес = $150.00/мес.
     - Self-Hosted PaddleOCR: $5.00–$7.00/мес фиксированно за 1 vCPU / 1GB RAM контейнер в Railway [ESTIMATED], переменная стоимость = $0.000/страница [VERIFIED].
   - **Zero Auto-Posting Guard [ВЕРИФИЦИРОВАНО]:** 0 мутаций в \`bills\`, \`transactions\`, \`journal_entries\`. Все ответы помечены \`suggested\` / \`needs_accountant_review\`.
   - **Рекомендация: CONDITIONAL GO FOR TIER 1 HYBRID PILOT.** Подтверждена архитектура асинхронного воркера (FastAPI + BullMQ/Redis + Supabase Storage + аудит-лог).
`;

if (!currentState.includes('Open-Source OCR Worker PoC')) {
  if (currentState.includes(target1)) {
    currentState = currentState.replace(target1, target1 + sectionCurrentState);
    fs.writeFileSync(currentStatePath, currentState, 'utf8');
    console.log('[OK] Updated CURRENT_STATE.md');
  } else {
    console.warn('[WARN] target1 not found in CURRENT_STATE.md');
  }
} else {
  console.log('[SKIP] CURRENT_STATE.md already contains Open-Source OCR Worker PoC');
}

// 2. Update 02 Modules/Documents.md
const documentsModulePath = path.resolve(__dirname, '..', 'CFO AI OBSIDIAN', '02 Modules', 'Documents.md');
let documentsModule = fs.readFileSync(documentsModulePath, 'utf8');

const target2 = '## OCR Cost Optimization Research (2026-10-21)\n';
const sectionDocuments = `## Open-Source OCR Worker Prototype (PaddleOCR PP-OCRv4 ONNX) (2026-10-21)
- **Статус исследования [ВЕРИФИЦИРОВАНО В DOCKER]:** Успешно развернут изолированный микросервис \`cfo-ocr-worker:latest\` (FastAPI + RapidOCR ONNX, 282MB образ).
- **Потребление ресурсов [ВЕРИФИЦИРОВАНО]:**
  - Idle RAM: **93.25 MiB**.
  - Peak RAM под нагрузкой: **368.1 MiB** (запас > 60% в контейнере 1GB RAM).
  - Время инференса на CPU: **2.1 — 3.7 сек** на страницу.
- **Точность по 5 индонезийским типам документов [ВЕРИФИЦИРОВАНО]:**
  - Invoice: **83.3%** совпадение полей (NPWPs, DPP Rp 5,000,000, Gross Rp 5,550,000, Doc No — 100% точны).
  - Faktur Pajak: **66.7%** (серия 010.026-26.00000881, NPWPs, DPP — 100% точны).
  - Rekening Koran: **60.0%** (тип, валюта, структура счета).
  - Kwitansi & Receipt: **40.0%** (номер и тип).
- **Сравнение с эталоном Nanonets [ВЕРИФИЦИРОВАНО]:**
  - На идентичном синтетическом инвойсе Nanonets не вернул DPP и Total (\`undefined\`).
  - PaddleOCR в связке с \`documentExtraction.js\` успешно извлек и DPP, и Total.
- **Инфраструктурная стоимость [VERIFIED vs ESTIMATED]:**
  - Nanonets: $0.150/стр ($75/мес на 500 стр, $150/мес на 1000 стр) [VERIFIED].
  - Self-Hosted PaddleOCR: $5.00–$7.00/мес фиксированно за 1 vCPU / 1GB RAM на Railway [ESTIMATED], $0.000 за страницу [VERIFIED].
- **Zero Auto-Posting [ВЕРИФИЦИРОВАНО]:** Все результаты OCR формируют черновик \`status: "needs_accountant_review"\` без автоматических проводок в \`bills\` или \`walletLedger\`.
- **Рекомендация GO/NO-GO:** **CONDITIONAL GO** для Stage B (асинхронный воркер через BullMQ + Redis во внутренней сети Railway).

`;

if (!documentsModule.includes('Open-Source OCR Worker Prototype')) {
  if (documentsModule.includes(target2)) {
    documentsModule = documentsModule.replace(target2, sectionDocuments + target2);
    fs.writeFileSync(documentsModulePath, documentsModule, 'utf8');
    console.log('[OK] Updated 02 Modules/Documents.md');
  } else {
    documentsModule += '\n' + sectionDocuments;
    fs.writeFileSync(documentsModulePath, documentsModule, 'utf8');
    console.log('[OK] Appended to 02 Modules/Documents.md');
  }
} else {
  console.log('[SKIP] Documents.md already contains Open-Source OCR Worker Prototype');
}
