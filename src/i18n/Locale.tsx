import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import translations from './translations.json'
export type Locale = 'en' | 'ka' | 'ru'
const dictionary = translations as Record<string, string[]>
export function translate(locale: Locale, key: string): string {
  if (locale === 'en') return key
  const index = locale === 'ka' ? 0 : 1
  if (dictionary[key]) return dictionary[key][index]
  for (const [pattern, values] of Object.entries(dictionary)) {
    if (!pattern.includes('{0}')) continue
    const escaped = pattern.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\d+\}/g, '(.+?)')
    const match = key.match(new RegExp('^' + escaped + '$'))
    if (match) return values[index].replace(/\{(\d+)\}/g, (_, n) => match[Number(n) + 1])
  }
  return key
}

const Context = createContext({ locale: 'en' as Locale, setLocale: (_locale: Locale) => {}, t: (key: string) => key })
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLanguage] = useState<Locale>(() => { try { const saved = localStorage.getItem('rai-language'); return saved === 'ka' || saved === 'ru' ? saved : 'en' } catch { return 'en' } })
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  const setLocale = (next: Locale) => { setLanguage(next); try { localStorage.setItem('rai-language', next) } catch { /* The selection still works for this session. */ } }
  return <Context.Provider value={{ locale, setLocale, t: key => translate(locale, key) }}>{children}</Context.Provider>
}
export const useLocale = () => useContext(Context)
