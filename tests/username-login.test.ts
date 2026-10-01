// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { register, signIn, saveChats } from '../src/accounts/vault'
beforeEach(() => { localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
test('username alias restores the existing encrypted account and rejects wrong passwords', async () => {
 const user = await register('nodo@example.com', 'password12345')
 const chats = [{id:'1',title:'Saved',messages:[],updated:1}]
 await saveChats(user, chats)
 expect((await signIn(' NODO ', 'password12345')).chats).toEqual(chats)
 await expect(signIn('nodo', 'wrong')).rejects.toThrow('incorrect')
})
test('ambiguous usernames require a full email', async () => {
 await register('nodo@one.com','password12345')
 await register('nodo@two.com','password12345')
 await expect(signIn('nodo','password12345')).rejects.toThrow('full email')
})
