// @vitest-environment jsdom
import {afterEach,expect,test,vi} from 'vitest'
import {cleanup,render,screen,waitFor} from '@testing-library/react'
import {DesktopModels} from '../src/offline/DesktopModels'
import {desktopStatus} from '../src/offline/desktop'
vi.mock('../src/offline/desktop',async original=>({...await original<typeof import('../src/offline/desktop')>(),desktopStatus:vi.fn()}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
test('an unavailable desktop engine cannot download or claim Active',async()=>{
 vi.mocked(desktopStatus).mockResolvedValue({available:false,memoryGB:0,installed:[],error:'Desktop engine unavailable'})
 render(<DesktopModels selectedChat="" selectedTranslator="" onChange={vi.fn()} disabled={false}/>)
 await screen.findByText('Desktop engine unavailable')
 expect(screen.queryByText('Active')).toBeNull()
 for(const button of screen.getAllByRole('button',{name:'Download'}))expect((button as HTMLButtonElement).disabled).toBe(true)
})
test('actual installation and selection determine Active',async()=>{
 vi.mocked(desktopStatus).mockResolvedValue({available:true,memoryGB:32,installed:['nllb-200-3.3b']})
 render(<DesktopModels selectedChat="" selectedTranslator="nllb-200-3.3b" onChange={vi.fn()} disabled={false}/>)
 await waitFor(()=>expect(screen.getByText('Active')).toBeTruthy())
 expect(screen.getAllByRole('button',{name:'Delete'})).toHaveLength(1)
})
