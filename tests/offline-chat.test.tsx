// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'
import { offlineReply } from '../src/offline/runtime'
vi.mock('../src/offline/models', async original => ({...await original<typeof import('../src/offline/models')>(), installedModels: vi.fn().mockResolvedValue(['qwen3-06','qwen3-17','qwen35-2'])}))
vi.mock('../src/offline/runtime', () => ({offlineReply:vi.fn().mockResolvedValue('A real local response.'),cancelOfflineReply:vi.fn(),unloadOfflineModel:vi.fn().mockResolvedValue(undefined)}))
vi.mock('../src/translation/package', () => ({packInstalled:vi.fn().mockResolvedValue(false)}))
vi.mock('../src/brains', async original => ({...await original<typeof import('../src/brains')>(),ensureDefaultOfflineBrain:vi.fn().mockResolvedValue({})}))
beforeEach(() => {
 localStorage.clear(); vi.clearAllMocks()
 vi.stubGlobal('matchMedia', () => ({matches:true,addEventListener(){},removeEventListener(){}}))
 Element.prototype.scrollTo = vi.fn()
})
afterEach(() => {cleanup(); vi.unstubAllGlobals()})
test('persisted local model receives chat input without an API', async () => {
 localStorage.setItem('rai-local-model','qwen3-17')
 render(<App />)
 fireEvent.click(screen.getByRole('button',{name:'Open chat'}))
 await waitFor(() => expect(screen.getByRole('combobox',{name:'Offline AI'})).toBeTruthy())
 fireEvent.change(screen.getByPlaceholderText('Write a message…'),{target:{value:'Hello local AI'}})
 fireEvent.submit(screen.getByPlaceholderText('Write a message…').closest('form')!)
 await waitFor(() => expect(offlineReply).toHaveBeenCalledWith('qwen3-17',expect.any(Array),'Hello local AI'))
 await waitFor(() => expect(screen.getByText('A real local response.')).toBeTruthy())
})
test('AI Lab exposes all three installed models and selection persists', async () => {
 render(<App />)
 fireEvent.click(screen.getByRole('button',{name:'AI Lab'}))
 await waitFor(() => expect(screen.getAllByRole('button',{name:'Use'})).toHaveLength(3))
 fireEvent.click(screen.getAllByRole('button',{name:'Use'})[2])
 await waitFor(() => expect(localStorage.getItem('rai-local-model')).toBe('qwen35-2'))
 expect(screen.getByRole('button',{name:'Selected'})).toBeTruthy()
})
