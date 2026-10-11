// Design v2 copy. EN is the final wording from the designs; RU and ID are
// translations. A key missing in RU/ID falls back to EN (listed in each batch
// report). Kept apart from client/src/i18n so the v2 strings ship only inside the
// lazy v2 chunk — with VITE_DESIGN_V2 off the production bundle is unchanged.
import { useCallback } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import { getLang } from '../../i18n/index'
import en from './en'
import ru from './ru'
import id from './id'

const DICTS = { en, ru, id }

const lookup = (dict, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict)

export function tr(key, vars, lang = getLang()) {
  let s = lookup(DICTS[lang] || en, key)
  if (s == null) s = lookup(en, key)
  if (s == null) return key
  if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])))
  return s
}

/** Hook form: re-renders on language change. */
export function useT() {
  const { lang } = useTranslation()
  return useCallback((key, vars) => tr(key, vars, lang), [lang])
}

export function useLang() { return useTranslation().lang }

export const DICTIONARIES = DICTS
