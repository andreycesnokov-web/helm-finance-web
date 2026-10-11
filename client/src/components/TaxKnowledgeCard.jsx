import React, { useState } from 'react';
import { Btn } from '../shell/ui';
import InfoTooltip from './InfoTooltip';
import './TaxKnowledgeCard.css';

/**
 * TaxKnowledgeCard:
 * Displays a structured card for an Indonesian tax topic according to PR #133 contract v2/v2.1
 * (schema_version: 2, contract: indonesia_tax_tooltip_v2).
 *
 * Semantic sections:
 * - Summary: definition -> mechanism -> main condition (or unavailable notice for partial cards)
 * - Abbreviation: official designated expansion (object format in v2)
 * - What is it (what_is) & How it works (how_it_works) & Main condition (main_condition)
 * - What to check (what_to_check)
 * - Gaps & Mandatory statutory archival notice
 * - Sources & Citations (claim_evidence)
 */
export default function TaxKnowledgeCard({
  card,
  lang = 'ru',
  onAskAccountant,
}) {
  const [showDrawer, setShowDrawer] = useState(false);

  if (!card) return null;

  const labels = {
    ru: {
      details: 'Подробнее',
      ask: 'Спросить AI Accountant',
      what: 'Что это',
      how: 'Как работает',
      condition: 'Главное условие',
      abbreviation: 'Официальное наименование',
      check: 'Что проверить',
      sources: 'Архивные нормативные источники',
      legalNotice: 'Обязательное правовое уведомление',
      docLink: '↗ Официальный текст документа',
      article: 'Статья',
      pages: 'Стр.',
      statusAvailable: 'Доступно',
      statusPartial: 'Частично',
      statusUnavailable: 'Недоступно',
      gapsTitle: 'Пробелы в подтверждённых источниках',
      unavailable: 'Не подтверждено источниками',
      close: 'Закрыть',
    },
    en: {
      details: 'Details',
      ask: 'Ask AI Accountant',
      what: 'What it is',
      how: 'How it works',
      condition: 'Main condition',
      abbreviation: 'Official designation',
      check: 'What to check',
      sources: 'Archived statutory sources',
      legalNotice: 'Mandatory statutory notice',
      docLink: '↗ Official document text',
      article: 'Article',
      pages: 'p.',
      statusAvailable: 'Available',
      statusPartial: 'Partial',
      statusUnavailable: 'Unavailable',
      gapsTitle: 'Documentary gaps',
      unavailable: 'Unavailable from confirmed sources',
      close: 'Close',
    },
    id: {
      details: 'Detail',
      ask: 'Tanya AI Accountant',
      what: 'Apa ini',
      how: 'Cara kerja',
      condition: 'Ketentuan utama',
      abbreviation: 'Penamaan resmi',
      check: 'Hal diperiksa',
      sources: 'Sumber hukum arsip',
      legalNotice: 'Pemberitahuan hukum wajib',
      docLink: '↗ Teks dokumen resmi',
      article: 'Pasal',
      pages: 'Hal.',
      statusAvailable: 'Tersedia',
      statusPartial: 'Sebagian',
      statusUnavailable: 'Belum tersedia',
      gapsTitle: 'Kekurangan bukti arsip',
      unavailable: 'Belum tersedia dari bukti arsip',
      close: 'Tutup',
    },
  }[lang] || {
    details: 'Подробнее',
    ask: 'Спросить AI Accountant',
    what: 'Что это',
    how: 'Как работает',
    condition: 'Главное условие',
    abbreviation: 'Официальное наименование',
    check: 'Что проверить',
    sources: 'Архивные нормативные источники',
    legalNotice: 'Обязательное правовое уведомление',
    docLink: '↗ Официальный текст документа',
    article: 'Статья',
    pages: 'Стр.',
    statusAvailable: 'Доступно',
    statusPartial: 'Частично',
    statusUnavailable: 'Недоступно',
    gapsTitle: 'Пробелы в подтверждённых источниках',
    unavailable: 'Не подтверждено источниками',
    close: 'Закрыть',
  };

  // 1. Statements extraction according to v2 presentation roles
  const summaryText = Array.isArray(card.summary) && card.summary.length
    ? card.summary.map(s => s.text).join(' ')
    : (card.unavailable_section_notice || (card.status === 'partial' ? labels.unavailable : ''));

  const whatIsText = Array.isArray(card.what_is) && card.what_is.length
    ? card.what_is.map(s => s.text).join(' ')
    : (card.unavailable_section_notice || labels.unavailable);

  const howItWorksText = Array.isArray(card.how_it_works) && card.how_it_works.length
    ? card.how_it_works.map(s => s.text).join(' ')
    : (card.unavailable_section_notice || labels.unavailable);

  const mainConditionText = Array.isArray(card.main_condition) && card.main_condition.length
    ? card.main_condition.map(s => s.text).join(' ')
    : '';

  // 2. Abbreviation object in schema_version: 2
  const abbreviationText = card.abbreviation?.status === 'available' && Array.isArray(card.abbreviation?.statements) && card.abbreviation.statements.length
    ? card.abbreviation.statements.map(s => s.text).join(' ')
    : null;

  const whatToCheckList = Array.isArray(card.what_to_check) ? card.what_to_check : [];
  const gapsList = Array.isArray(card.gaps) ? card.gaps : [];

  const handleAsk = () => {
    const qText = card.ask_accountant?.question || `Explain ${card.name}`;
    if (onAskAccountant) {
      onAskAccountant(qText);
    } else {
      const input = document.getElementById('acc-ask');
      if (input) {
        input.value = qText;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      } else {
        window.location.href = `/business/accountant?ask=${encodeURIComponent(qText)}`;
      }
    }
  };

  const statusLabel = card.status === 'available'
    ? labels.statusAvailable
    : card.status === 'partial'
    ? labels.statusPartial
    : labels.statusUnavailable;

  const humanSourceTitle = (sourceId) => {
    if (!sourceId) return 'Dokumen Resmi';
    const s = String(sourceId).replace(/_/g, ' ');
    if (s.startsWith('PMK')) return `Peraturan Menteri Keuangan (${s})`;
    if (s.startsWith('UU')) return `Undang-Undang (${s})`;
    if (s.startsWith('PP')) return `Peraturan Pemerintah (${s})`;
    return s;
  };

  return (
    <>
      <div className="tax-card">
        <div>
          <div className="tax-card-header">
            <h4 className="tax-card-title">
              {card.name}
              <InfoTooltip
                title={card.name}
                what={whatIsText}
                how={howItWorksText}
                interpret={card.required_notice}
                lang={lang}
              />
            </h4>
            <span className={`tax-card-badge ${card.status === 'available' ? 'is-available' : 'is-partial'}`}>
              {statusLabel}
            </span>
          </div>

          {abbreviationText && (
            <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--text-muted)', marginBottom: 6 }}>
              {abbreviationText}
            </div>
          )}

          <div className="tax-card-summary">
            {summaryText}
          </div>

          {card.required_notice && (
            <div className="tax-card-notice">
              ⚠ {card.required_notice}
            </div>
          )}
        </div>

        <div className="tax-card-actions">
          <Btn sm variant="ghost" onClick={() => setShowDrawer(true)}>
            {labels.details}
          </Btn>
          <Btn sm onClick={handleAsk}>
            {labels.ask}
          </Btn>
        </div>
      </div>

      {showDrawer && (
        <div className="tax-drawer-scrim" onClick={() => setShowDrawer(false)}>
          <div className="tax-drawer" onClick={e => e.stopPropagation()}>
            <div className="tax-drawer-head">
              <div>
                <h3 className="tax-drawer-title">{card.name}</h3>
                {abbreviationText && (
                  <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                    {abbreviationText}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="tax-drawer-close"
                onClick={() => setShowDrawer(false)}
                aria-label={labels.close}
              >
                ✕
              </button>
            </div>

            <div className="tax-drawer-body">
              <div className="tax-drawer-section">
                <span className="tax-drawer-section-title">{labels.what}</span>
                <p className="tax-drawer-section-content">{whatIsText}</p>
              </div>

              <div className="tax-drawer-section">
                <span className="tax-drawer-section-title">{labels.how}</span>
                <p className="tax-drawer-section-content">{howItWorksText}</p>
              </div>

              {mainConditionText && (
                <div className="tax-drawer-section">
                  <span className="tax-drawer-section-title">{labels.condition}</span>
                  <p className="tax-drawer-section-content">{mainConditionText}</p>
                </div>
              )}

              {whatToCheckList.length > 0 && (
                <div className="tax-drawer-section">
                  <span className="tax-drawer-section-title">{labels.check}</span>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-primary)' }}>
                    {whatToCheckList.map((c, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {c.text || c.field}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {card.status === 'partial' && gapsList.length > 0 && (
                <div className="tax-drawer-section">
                  <span className="tax-drawer-section-title">{labels.gapsTitle}</span>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-warn, #b45309)' }}>
                    {gapsList.map((g, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {Array.isArray(card.claim_evidence) && card.claim_evidence.length > 0 && (
                <div className="tax-drawer-section">
                  <span className="tax-drawer-section-title">
                    {labels.sources} ({card.claim_evidence.length})
                  </span>
                  <ul className="tax-drawer-citations">
                    {card.claim_evidence.map((ev, i) => (
                      <li key={i} className="tax-citation-item">
                        <div><b>{humanSourceTitle(ev.source_id)}</b></div>
                        <div style={{ marginTop: 2, color: 'var(--text-secondary)' }}>
                          {ev.article ? `${labels.article} ${ev.article}` : ''}
                          {ev.paragraphs ? ` ayat ${ev.paragraphs}` : ''}
                          {ev.pages && ev.pages.length ? ` · ${labels.pages} ${ev.pages.join(', ')}` : ''}
                        </div>
                        {ev.text_anchor && (
                          <div style={{ marginTop: 4, fontStyle: 'italic', color: 'var(--text-muted)' }}>
                            «{ev.text_anchor}»
                          </div>
                        )}
                        {Array.isArray(ev.links) && ev.links[0] && (
                          <div style={{ marginTop: 6 }}>
                            <a
                              href={ev.links[0]}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="tax-citation-link"
                            >
                              {labels.docLink}
                            </a>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {card.required_notice && (
                <div className="tax-card-notice" style={{ marginTop: 10 }}>
                  <b>{labels.legalNotice}:</b><br />
                  {card.required_notice}
                </div>
              )}
            </div>

            <div className="tax-drawer-foot">
              <Btn variant="ghost" onClick={() => setShowDrawer(false)}>{labels.close}</Btn>
              <Btn onClick={() => { setShowDrawer(false); handleAsk(); }}>
                {labels.ask}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
