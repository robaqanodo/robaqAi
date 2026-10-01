// @vitest-environment jsdom
import React from 'react'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import App from '../src/App'
import { translate } from '../src/i18n/Locale'
import keys from '../src/i18n/keys.json'
import dictionary from '../src/i18n/translations.json'
vi.mock('../src/brains', async original => ({ ...await original<typeof import('../src/brains')>(), ensureDefaultOfflineBrain: vi.fn().mockResolvedValue({}) }))
vi.mock('../src/translation/package', () => ({ packInstalled: vi.fn().mockResolvedValue(false), PACK_MIB: 611, PACK_URL: '', downloadPack: vi.fn(), installPack: vi.fn() }))
beforeEach(() => {
 localStorage.clear()
 vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
 vi.stubGlobal('speechSynthesis', { cancel() {}, getVoices: () => [], addEventListener() {}, removeEventListener() {} })
 Element.prototype.scrollTo = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
test('every extracted interface string has Georgian and Russian translations', () => {
 for(const key of keys) expect((dictionary as Record<string, string[]>)[key],key).toHaveLength(2)
 expect(translate('ka', 'Downloading language pack… 50%')).toBe('ენის პაკეტის ჩამოტვირთვა… 50%')
 expect(translate('ru', 'Detected a Gemini API key. Select Gemini below to add this key.')).toContain('Обнаружен ключ API Gemini')
})
test('English is default; changing language updates menus and persists after reopening', () => {
 render(<App />)
 fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
 expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('en')
 fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ka' } })
 expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
 expect(screen.getByRole('button', { name: 'მთავარი' })).toBeTruthy()
 expect(document.documentElement.lang).toBe('ka')
 cleanup(); render(<App />)
 fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
 fireEvent.change(screen.getByLabelText('ენა'), { target: { value: 'ru' } })
 expect(screen.getByRole('heading', { name: 'Настройки' })).toBeTruthy()
 fireEvent.click(screen.getByRole('button', { name: 'Закрыть', exact: true }))
 fireEvent.click(screen.getByRole('button', { name: 'Регистрация или вход' }))
 expect(screen.getByRole('button', { name: 'Продолжить как гость' })).toBeTruthy()
 expect(localStorage.getItem('rai-language')).toBe('ru')
})
