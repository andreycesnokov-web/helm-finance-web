import { useState, useEffect } from 'react'
import { t, setLang, getLang } from '../i18n/index'

export function useTranslation() {
  const [lang, setLangState] = useState(getLang())

  useEffect(() => {
    const handler = () => setLangState(getLang())
    window.addEventListener('langchange', handler)
    return () => window.removeEventListener('langchange', handler)
  }, [])

  const changeLang = (newLang) => {
    setLang(newLang)
    setLangState(newLang)
  }

  return { t, lang, changeLang }
}