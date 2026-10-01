import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

let failed = false
function check(label, valid, detail = '') {
  console.log(`${valid ? 'OK' : 'MISSING'}: ${label}${detail ? ` — ${detail}` : ''}`)
  if (!valid) failed = true
}
check('iOS Xcode project', existsSync('ios/App/App.xcodeproj/project.pbxproj'))
check('Bundled application', existsSync('ios/App/App/public/index.html'))
const xcode = spawnSync('xcodebuild', ['-version'], { encoding: 'utf8' })
check('Full Xcode', xcode.status === 0, xcode.status === 0 ? xcode.stdout.trim() : 'Install Xcode and select it under Xcode > Settings > Locations')
const sdk = spawnSync('xcrun', ['--sdk', 'iphoneos', '--show-sdk-version'], { encoding: 'utf8' })
check('iPhone SDK', sdk.status === 0, sdk.status === 0 ? sdk.stdout.trim() : 'Install iOS platform support in Xcode')
console.log('For a physical iPhone, select your Apple development team in Signing & Capabilities.')
process.exitCode = failed ? 1 : 0
