import { deleteAccount, type Session } from './vault'
import { clearPack } from '../translation/storage'
import { stopTranslationWorker } from '../translation/client'
import { MODELS, removeModel } from '../offline/models'
import { unloadOfflineModel } from '../offline/runtime'
export async function deleteProfileData(session: Session) {
  stopTranslationWorker()
  await unloadOfflineModel()
  await clearPack()
  for (const model of MODELS) await removeModel(model.id)
  await deleteAccount(session)
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('rai-account-v1:') && /^(rai-|grok-chat-|ostra-)/.test(key)) localStorage.removeItem(key)
  }
}
