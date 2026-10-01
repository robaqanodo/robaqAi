import { beforeEach, expect, test, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { register, signIn, saveChats, type Conversation } from '../src/accounts/vault'
const data = new Map<string, string>()
beforeEach(() => {
  data.clear()
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('localStorage', { removeItem: (key: string) => data.delete(key), getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } })
})
const chats: Conversation[] = [{ id: 'chat-one', title: 'Private conversation', messages: [{ id: 'm1', role: 'user', text: 'Private secret message' }], updated: 1 }]
test('registers, encrypts history, and restores it only with the correct password', async () => {
  const account = await register(' User@Example.com ', 'user123321')
  await saveChats(account, chats)
  expect(account.email).toBe('user@example.com')
  const stored = [...data.values()].join('')
  expect(stored).not.toContain('user123321')
  expect(stored).not.toContain('Private secret message')
  expect((await signIn('USER@example.com', 'user123321')).chats).toEqual(chats)
  await expect(signIn('user@example.com', 'incorrect-password')).rejects.toThrow('incorrect')
})
test('rejects duplicate accounts and isolates account histories', async () => {
  const first = await register('first@example.com', 'user123321')
  await saveChats(first, chats)
  await register('second@example.com', 'other123321')
  expect((await signIn('second@example.com', 'other123321')).chats).toEqual([])
  await expect(register('FIRST@example.com', 'replacement123')).rejects.toThrow('already')
  expect((await signIn('first@example.com', 'user123321')).chats).toEqual(chats)
})
test('serializes writes so the latest chat revision wins', async () => {
  const account = await register('writer@example.com', 'user123321')
  await Promise.all([saveChats(account, chats), saveChats(account, [{ ...chats[0], title: 'Latest' }])])
  expect((await signIn('writer@example.com', 'user123321')).chats[0].title).toBe('Latest')
})
test('rejects invalid registration and unknown sign-in', async () => {
  await expect(register('invalid', 'user123321')).rejects.toThrow('valid email')
  await expect(register('user@example.com', 'short')).rejects.toThrow('10 characters')
  await expect(signIn('missing@example.com', 'user123321')).rejects.toThrow('No account')
  expect(data.size).toBe(0)
})

test('an in-flight save cannot recreate an account after site data is cleared', async () => {
  const account = await register('clear@example.com', 'user123321')
  const pending = saveChats(account, chats)
  data.clear()
  await expect(pending).rejects.toThrow()
  expect(data.size).toBe(0)
})

test('admin test account rejects wrong passwords and preserves its history on later sign-ins', async () => {
  await expect(signIn('admin', 'wrong')).rejects.toThrow('No account')
  const first = await signIn('admin', 'admin')
  await saveChats(first.session, chats)
  expect((await signIn('admin', 'admin')).chats).toEqual(chats)
  await expect(register('new@example.com', 'admin')).rejects.toThrow('10 characters')
})

test('profile names persist and deletion cannot be undone by a queued chat save', async () => {
  const {updateProfile, deleteAccount} = await import('../src/accounts/vault')
  const session = await register('profile@example.com','password12345')
  const named = await updateProfile(session,'Nodar','Robakidze')
  expect((await signIn(session.email,'password12345')).session.firstName).toBe('Nodar')
  const saving = saveChats(named,[{id:'delete-me',title:'Private',messages:[],updated:1}])
  await deleteAccount(named)
  await saving.catch(()=>{})
  await expect(signIn(session.email,'password12345')).rejects.toThrow()
})
