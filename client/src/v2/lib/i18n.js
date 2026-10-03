// v2 copy goes through the app's existing language state (client/src/i18n):
// same getLang(), same 'langchange' event, same EN fallback rule. Only the
// dictionaries are separate so they ship in the v2 chunk, not the main bundle.
import { useEffect, useState, useCallback } from 'react'
import { getLang } from '../../i18n/index'
import en from '../../i18n/v2/en'
import ru from '../../i18n/v2/ru'
import id from '../../i18n/v2/id'

const DICTS = { en, ru, id }

export function translate(lang, key, vars) {
  const raw = (DICTS[lang] && DICTS[lang][key]) ?? en[key] ?? key
  if (!vars) return raw
  return String(raw).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])))
}

export function useV2T() {
  const [lang, setLang] = useState(getLang())
  useEffect(() => {
    const h = () => setLang(getLang())
    window.addEventListener('langchange', h)
    return () => window.removeEventListener('langchange', h)
  }, [])
  const t = useCallback((key, vars) => translate(lang, key, vars), [lang])
  return { t, lang }
}

export const LOCALE = { en: 'en-GB', ru: 'ru-RU', id: 'id-ID' }
