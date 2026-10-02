// @vitest-environment jsdom
import {act,cleanup,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {createRef} from 'react'
vi.mock('../src/kas/client',()=>({kasRequest:vi.fn()}))
import {kasRequest} from '../src/kas/client'
import {KasReader} from '../src/kas/Kas'
import {LocaleProvider,translate} from '../src/i18n/Locale'
beforeEach(()=>{localStorage.setItem('rai-language','ka');vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:()=>{},removeEventListener:()=>{}}));Element.prototype.scrollTo=vi.fn();vi.mocked(kasRequest).mockReset()})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('asks automatically, localizes instructions and preserves author question/answer languages',async()=>{vi.mocked(kasRequest).mockResolvedValueOnce({questions:['რომელი ქალაქი?'],count:2} as any).mockResolvedValueOnce({question:'Which year?',proof:'proof'} as any);const ref=createRef<((s:string)=>void)|null>();render(<LocaleProvider><KasReader code="KAS-TEST" submitRef={ref} onClose={()=>{}}/></LocaleProvider>);await waitFor(()=>expect(screen.getAllByText('რომელი ქალაქი?').length).toBeGreaterThan(0));expect(screen.getAllByText(translate('ka','You are in the KAS secret space. Answer each question exactly as the author did.')).length).toBeGreaterThan(0);expect(screen.queryByText('Reply yes or no.')).toBeNull();await act(async()=>ref.current?.('London'));expect(kasRequest).toHaveBeenLastCalledWith(expect.objectContaining({action:'verify',answer:'London',index:0}),expect.any(AbortSignal));expect(screen.getAllByText('Which year?').length).toBeGreaterThan(0)})
