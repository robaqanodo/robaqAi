import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize, KeyboardStyle } from '@capacitor/keyboard'

const config: CapacitorConfig = {
  appId: 'com.nodo92.rai',
  appName: 'robaq AI',
  webDir: 'dist',
  backgroundColor: '#050507',
  ios: {
    contentInset: 'never',
    backgroundColor: '#050507',
    preferredContentMode: 'mobile',
    scrollEnabled: false,
  },
  plugins: {
    CapacitorHttp: { enabled: true },
    Keyboard: { resize: KeyboardResize.Native, style: KeyboardStyle.Dark },
    StatusBar: { style: 'DARK' },
  },
}

export default config
