const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const aiAccountantCore = require('../../server/lib/aiAccountantCore.js');
const { getCard } = require('../../server/lib/indonesiaTaxKnowledgeCards.cjs');

describe('AI Accountant Human-Readable Limitations and Sources (PR)', () => {
  const TECHNICAL_CODES = [
    'tax_period_missing',
    'current_provision_currency_unconfirmed',
    'dependency_source_missing',
    'amendment_review_incomplete',
    'TER_table_not_verified',
  ];

  it('1. Code Translation Dictionary matches required RU / EN / ID specifications', () => {
    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.tax_period_missing.ru, 'Не указан налоговый период');
    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.tax_period_missing.en, 'Tax period is not specified');
    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.tax_period_missing.id, 'Periode pajak belum ditentukan');

    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.current_provision_currency_unconfirmed.ru, 'Актуальность нормы пока не подтверждена');
    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.current_provision_currency_unconfirmed.en, 'Statutory currency is not yet confirmed');
    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.current_provision_currency_unconfirmed.id, 'Keberlakuan ketentuan belum dikonfirmasi');

    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.dependency_source_missing.ru, 'Не хватает связанного нормативного источника');
    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.dependency_source_missing.en, 'Related statutory source is missing');
    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.dependency_source_missing.id, 'Sumber hukum terkait belum tersedia');

    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.amendment_review_incomplete.ru, 'Проверка изменений законодательства ещё не завершена');
    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.amendment_review_incomplete.en, 'Amendment review is not yet complete');
    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.amendment_review_incomplete.id, 'Peninjauan perubahan peraturan belum selesai');

    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.TER_table_not_verified.ru, 'Таблицы расчёта удержаний пока не проверены');
    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.TER_table_not_verified.en, 'Withholding calculation tables are not yet verified');
    assert.equal(aiAccountantCore.BLOCKER_EXPLANATIONS.TER_table_not_verified.id, 'Tabel perhitungan pemotongan belum diverifikasi');
  });

  it('2. Unknown blocker codes are mapped to neutral explanation with raw code saved in diagnostics', () => {
    const res = aiAccountantCore.getBlockerReasons({
      blockers: [{ code: 'tax_period_missing' }, { code: 'future_unimplemented_statute_check' }],
      language: 'ru',
    });

    assert.deepEqual(res.reasons, [
      'Не указан налоговый период',
      'Требуется дополнительная проверка условий',
    ]);
    assert.equal(res.diagnostics.length, 2);
    assert.equal(res.diagnostics[1].code, 'future_unimplemented_statute_check');
    assert.equal(res.diagnostics[1].status, 'unknown');
    assert.ok(res.rawCodes.includes('future_unimplemented_statute_check'));
  });

  it('3. PPh 21 Deterministic Fallback: Clean human explanation across RU / EN / ID', () => {
    const questions = {
      ru: 'Объясни PPh 21 — Pajak Penghasilan Pasal 21 по доступным источникам и укажи ограничения.',
      en: 'Explain PPh 21 — Pajak Penghasilan Pasal 21 with available sources and specify limitations.',
      id: 'Jelaskan PPh 21 — Pajak Penghasilan Pasal 21 berdasarkan sumber yang tersedia dan sebutkan batasannya.',
    };

    for (const [lang, q] of Object.entries(questions)) {
      const answer = aiAccountantCore.generateDeterministicFallbackAnswer({
        question: q,
        language: lang,
        counterpartiesMap: {},
        walletsWithBalance: [],
        taxData: {},
      });

      // No raw technical codes in visible answer
      for (const code of TECHNICAL_CODES) {
        assert.ok(!answer.includes(code), `Answer in ${lang} must not contain raw code: ${code}`);
      }
      assert.ok(!answer.includes('PMK168_2023'), `Answer in ${lang} must not contain raw source ID PMK168_2023`);
      assert.ok(!answer.includes('Применимость к компании заблокирована'), `Answer in ${lang} must not contain old blocker phrasing`);

      // Human sources
      assert.ok(answer.includes('PMK 168/2023'), `Answer in ${lang} must contain readable PMK 168/2023`);

      // Designated unconfirmed section
      if (lang === 'ru') {
        assert.ok(answer.includes('### Что пока не подтверждено'));
        assert.ok(answer.includes('уточнить налоговый период'));
        assert.ok(answer.includes('актуальность правил и таблиц расчёта'));
        assert.ok(answer.includes('Пока я не могу подтвердить ставку или сумму налога.'));
      } else if (lang === 'en') {
        assert.ok(answer.includes('### What is not yet confirmed'));
        assert.ok(answer.includes('specify the tax period'));
        assert.ok(answer.includes('verify the currency of rules and calculation tables'));
        assert.ok(answer.includes('I cannot confirm the tax rate or amount yet.'));
      } else if (lang === 'id') {
        assert.ok(answer.includes('### Hal yang belum dikonfirmasi'));
        assert.ok(answer.includes('menentukan periode pajak'));
        assert.ok(answer.includes('memverifikasi keberlakuan peraturan dan tabel perhitungan'));
        assert.ok(answer.includes('Saya belum dapat mengonfirmasi tarif atau jumlah pajak saat ini.'));
      }
    }
  });

  it('4. PPh 26 Deterministic Fallback: Clean human explanation across RU / EN / ID', () => {
    const questions = {
      ru: 'Объясни PPh 26 — Pajak Penghasilan Pasal 26 по доступным источникам и укажи ограничения.',
      en: 'Explain PPh 26 — Pajak Penghasilan Pasal 26 with available sources and specify limitations.',
      id: 'Jelaskan PPh 26 — Pajak Penghasilan Pasal 26 berdasarkan sumber yang tersedia dan sebutkan batasannya.',
    };

    for (const [lang, q] of Object.entries(questions)) {
      const answer = aiAccountantCore.generateDeterministicFallbackAnswer({
        question: q,
        language: lang,
        counterpartiesMap: {},
        walletsWithBalance: [],
        taxData: {},
      });

      // No raw technical codes
      for (const code of TECHNICAL_CODES) {
        assert.ok(!answer.includes(code), `Answer in ${lang} must not contain raw code: ${code}`);
      }
      assert.ok(!answer.includes('DJP_SDSN_2023'), `Answer in ${lang} must not contain raw ID DJP_SDSN_2023`);
      assert.ok(!answer.includes('PMK168_2023'), `Answer in ${lang} must not contain raw ID PMK168_2023`);
      assert.ok(!answer.includes('Применимость к компании заблокирована'));

      // Human sources
      assert.ok(answer.includes('UU PPh (UU 6/2023)'));
      assert.ok(answer.includes('PMK 168/2023'));

      // Unconfirmed section reflecting actual PPh 26 blockers (period + currency + related source)
      if (lang === 'ru') {
        assert.ok(answer.includes('### Что пока не подтверждено'));
        assert.ok(answer.includes('уточнить налоговый период'));
        assert.ok(answer.includes('связанные нормативные источники'));
        // PPh 26 must not mention withholding calculation tables (TER is only for PPh 21)
        assert.ok(!answer.includes('таблиц расчёта'));
      } else if (lang === 'en') {
        assert.ok(answer.includes('### What is not yet confirmed'));
        assert.ok(answer.includes('specify the tax period'));
        assert.ok(answer.includes('related statutory sources'));
        assert.ok(!answer.includes('calculation tables'));
      } else if (lang === 'id') {
        assert.ok(answer.includes('### Hal yang belum dikonfirmasi'));
        assert.ok(answer.includes('menentukan periode pajak'));
        assert.ok(answer.includes('sumber hukum terkait'));
        assert.ok(!answer.includes('tabel perhitungan'));
      }
    }
  });

  it('5. Model Prompt Builder includes strict anti-code rules and human source/limitation instructions', () => {
    const card = getCard({ topic_id: 'pph21', language: 'ru' });
    const prompt = aiAccountantCore.buildAccountantPrompt({
      business: { name: 'Helm Care Indonesia' },
      facts: {
        company: { name: 'Helm Care Indonesia' },
        tax_knowledge_card: {
          name: card.name,
          sources: aiAccountantCore.formatHumanSources(card, 'ru'),
          unconfirmed_section: aiAccountantCore.formatUnconfirmedSection({ card, language: 'ru' }),
        },
      },
      question: 'Объясни PPh 21',
      language: 'ru',
    });

    assert.ok(prompt.includes('NEVER output technical blocker codes'));
    assert.ok(prompt.includes('tax_period_missing'));
    assert.ok(prompt.includes('NEVER use phrasing like "Применимость к компании заблокирована"'));
    assert.ok(prompt.includes('### Что пока не подтверждено'));
    assert.ok(prompt.includes('NEVER expose internal raw IDs like "PMK168_2023"'));
  });

  it('6. Underlying KB constraints, machine blockers and verification remain intact', () => {
    const card21 = getCard({ topic_id: 'pph21', language: 'ru' });
    const card26 = getCard({ topic_id: 'pph26', language: 'ru' });

    // Machine contracts must NOT be weakened
    assert.equal(card21.numerical_use.status, 'blocked');
    assert.equal(card21.applicability.status, 'blocked');
    assert.ok(card21.blockers.some(b => b.code === 'tax_period_missing'));
    assert.ok(card21.blockers.some(b => b.code === 'TER_table_not_verified'));

    assert.equal(card26.numerical_use.status, 'blocked');
    assert.equal(card26.applicability.status, 'blocked');
    assert.ok(card26.blockers.some(b => b.code === 'tax_period_missing'));
    assert.ok(card26.blockers.some(b => b.code === 'dependency_source_missing'));
  });
});
