import { guestSkillSnapshot, setPersistentSkills } from './skillSession'
import { writeFile as writeModel } from './offline/storage'
import { writeFile as writeTranslation } from './translation/storage'

export async function retainGuestSkills() {
  const { models, translations, settings } = guestSkillSnapshot()
  setPersistentSkills(true)
  for (const [name, blob] of models) await writeModel(name, blob)
  for (const [name, blob] of translations) await writeTranslation(name, blob)
  for (const [key, value] of settings) localStorage.setItem(key, value)
}
