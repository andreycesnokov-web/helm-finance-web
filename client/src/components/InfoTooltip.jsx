import React, { useState, useEffect, useRef } from 'react';
import { TOOLTIP_DICTIONARY } from '../lib/tooltipDictionary';
import './InfoTooltip.css';

/**
 * Universal InfoTooltip component for CFO Finance OS.
 * Features:
 * - Desktop: hover, focus, click triggers
 * - Mobile (320px/390px): tap toggle, fixed bottom sheet/popover
 * - Keyboard accessible: Esc closes, Enter/Space opens
 * - Click outside detection
 * - ru / en / id multi-language support (defaults to 'ru' or document lang)
 * - 'warning' variant switches trigger to '⚠'
 */
export default function InfoTooltip({
  term,
  title,
  what,
  how,
  interpret,
  lang = 'ru',
  isWarning = false,
  className = '',
  ariaLabel
}) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);

  // Resolve dictionary entry if term provided
  const entry = term && TOOLTIP_DICTIONARY[term] ? TOOLTIP_DICTIONARY[term][lang] || TOOLTIP_DICTIONARY[term]['en'] || TOOLTIP_DICTIONARY[term]['ru'] : null;

  const displayTitle = title || (entry && entry.title) || '';
  const displayWhat = what || (entry && entry.what) || '';
  const displayHow = how || (entry && entry.how) || '';
  const displayInterpret = interpret || (entry && entry.interpret) || '';

  // Labels for sections based on lang
  const sectionLabels = {
    ru: { what: 'Что это', how: 'Как рассчитывается', interpret: 'Как читать', close: 'Закрыть' },
    en: { what: 'What it is', how: 'How it works', interpret: 'How to read', close: 'Close' },
    id: { what: 'Apa ini', how: 'Cara hitung', interpret: 'Cara baca', close: 'Tutup' }
  }[lang] || { what: 'Что это', how: 'Как рассчитывается', interpret: 'Как читать', close: 'Закрыть' };

  // Handle escape key and click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        if (buttonRef.current) buttonRef.current.focus();
      }
    }

    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  const toggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const close = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);
    if (buttonRef.current) buttonRef.current.focus();
  };

  return (
    <span
      className={`info-tooltip-wrapper ${className}`}
      ref={wrapperRef}
      onMouseEnter={() => {
        // Only open on desktop mouseenter (screen width > 768px)
        if (typeof window !== 'undefined' && window.innerWidth > 768) {
          setIsOpen(true);
        }
      }}
      onMouseLeave={() => {
        if (typeof window !== 'undefined' && window.innerWidth > 768) {
          setIsOpen(false);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`info-tooltip-btn ${isWarning ? 'is-warn' : ''}`}
        onClick={toggle}
        aria-expanded={isOpen}
        aria-label={ariaLabel || displayTitle || 'Справка'}
      >
        {isWarning ? '⚠' : 'ⓘ'}
      </button>

      {isOpen && (
        <div
          className="info-tooltip-popover"
          role="dialog"
          aria-modal="false"
          aria-label={displayTitle}
        >
          <div className="info-tooltip-header">
            <span className="info-tooltip-title">
              {isWarning ? '⚠ ' : 'ⓘ '}
              {displayTitle}
            </span>
            <button
              type="button"
              className="info-tooltip-close"
              onClick={close}
              aria-label={sectionLabels.close}
            >
              ✕
            </button>
          </div>

          {displayWhat && (
            <div className="info-tooltip-section">
              <span className="info-tooltip-label">{sectionLabels.what}</span>
              <p className="info-tooltip-text">{displayWhat}</p>
            </div>
          )}

          {displayHow && (
            <div className="info-tooltip-section">
              <span className="info-tooltip-label">{sectionLabels.how}</span>
              <p className="info-tooltip-text">{displayHow}</p>
            </div>
          )}

          {displayInterpret && (
            <div className="info-tooltip-section">
              <span className="info-tooltip-label">{sectionLabels.interpret}</span>
              <p className="info-tooltip-text">{displayInterpret}</p>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
