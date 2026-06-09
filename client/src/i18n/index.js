import ru from './ru'
import en from './en'

const translations = { ru, en }

let currentLang = localStorage.getItem('hf_lang') || 'ru'

export const t = (key) => {
  const keys = key.split('.')
  let val = translations[currentLang]
  for (const k of keys) val = val?.[k]
  if (val) return val
  let fallback = translations['en']
  for (const k of keys) fallback = fallback?.[k]
  return fallback || key
}

export const setLang = (lang) => {
  currentLang = lang
  localStorage.setItem('hf_lang', lang)
  window.dispatchEvent(new Event('langchange'))
}

export const getLang = () => currentLang
