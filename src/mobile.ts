import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'

/** Resize with Safari's visual viewport; native iOS resizes the web view itself. */
export function initializeMobile() {
  const root = document.documentElement
  const native = Capacitor.isNativePlatform()
  root.classList.toggle('native-app', native)
  const updateViewport = () => {
    const height = native ? window.innerHeight : window.visualViewport?.height ?? window.innerHeight
    root.style.setProperty('--app-height', `${height}px`)
    root.style.setProperty('--viewport-top', `${native ? 0 : window.visualViewport?.offsetTop ?? 0}px`)
  }
  updateViewport()
  window.addEventListener('resize', updateViewport)
  window.visualViewport?.addEventListener('resize', updateViewport)
  window.visualViewport?.addEventListener('scroll', updateViewport)
  if (Capacitor.getPlatform() === 'ios') {
    void Keyboard.addListener('keyboardWillShow', () => root.classList.add('keyboard-open'))
    void Keyboard.addListener('keyboardWillHide', () => root.classList.remove('keyboard-open'))
  }
}
