// @vitest-environment jsdom
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import App from '../src/App'
import {desktopInference} from '../src/offline/desktop'
vi.mock('../src/offline/desktop',async original=>({...await original<typeof import('../src/offline/desktop')>(),desktopStatus:vi.fn().mockResolvedValue({available:true,memoryGB:8,installed:['nllb-200-3.3b']}),desktopInference:vi.fn().mockResolvedValue('translation'),cancelDesktopReply:vi.fn()}))
vi.mock('../src/offline/models',async original=>({...await original<typeof import('../src/offline/models')>(),installedModels:vi.fn().mockResolvedValue([])}))
vi.mock('../src/offline/runtime',()=>({offlineReply:vi.fn(),cancelOfflineReply:vi.fn(),unloadOfflineModel:vi.fn().mockResolvedValue(undefined)}))
vi.mock('../src/translation/package',()=>({packInstalled:vi.fn().mockResolvedValue(false)}))
vi.mock('../src/brains',async original=>({...await original<typeof import('../src/brains')>(),ensureDefaultOfflineBrain:vi.fn().mockResolvedValue({})}))
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));Element.prototype.scrollTo=vi.fn()})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
test('native translator works in chat without M2M100 or an API key',async()=>{
 render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Open chat'}))
 await waitFor(()=>expect(screen.getByRole('button',{name:'#Translator'}).getAttribute('aria-pressed')).toBe('true'))
 const input=screen.getByPlaceholderText('Write a message…')
 fireEvent.change(input,{target:{value:'dog'}});fireEvent.submit(input.closest('form')!)
 await waitFor(()=>expect(desktopInference).toHaveBeenCalledWith('translate',{model:'nllb-200-3.3b',text:'dog',source:'en',target:'ka'}))
 await waitFor(()=>expect(desktopInference).toHaveBeenCalledWith('translate',{model:'nllb-200-3.3b',text:'dog',source:'en',target:'ru'}))
})
