import { packager } from '@electron/packager'
import { execFileSync } from 'node:child_process'
import { cp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import manifest from '../package.json'
import electron from 'electron/package.json'

const identityName = '.sct Development'
const bundleId = 'com.omavashia2005.sct'

if (process.platform !== 'darwin' || (process.arch !== 'arm64' && process.arch !== 'x64')) {
  throw new Error('The signed macOS build requires an Apple Silicon or Intel Mac.')
}

const identities = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
  encoding: 'utf8'
}).split('\n').filter((line) => line.trimEnd().endsWith(`"${identityName}"`))

if (identities.length !== 1) {
  throw new Error(`Keep exactly one valid "${identityName}" identity in your Keychain. See docs/macos-signing.md.`)
}

const identity = identities[0].match(/\b[0-9A-F]{40}\b/i)?.[0]
if (!identity) throw new Error('Cannot read the signing certificate fingerprint.')

// The main process loads @napi-rs/keyring at runtime. Vite does not bundle native modules, so the app needs a copy.
// The listed dependency keeps the packager's prune step from removing the copy.
await writeFile('out/package.json', JSON.stringify({
  name: manifest.name,
  version: manifest.version,
  description: manifest.description,
  main: 'main/index.js',
  dependencies: { '@napi-rs/keyring': manifest.dependencies['@napi-rs/keyring'] }
}, null, 2))
await rm('out/node_modules', { recursive: true, force: true })
for (const name of ['@napi-rs/keyring', `@napi-rs/keyring-darwin-${process.arch}`]) {
  await cp(join('node_modules', name), join('out/node_modules', name), { recursive: true, dereference: true })
}

const [output] = await packager({
  dir: 'out',
  out: 'dist',
  name: 'sct',
  appBundleId: bundleId,
  appCategoryType: 'public.app-category.developer-tools',
  extendInfo: {
    CFBundleDocumentTypes: [{
      CFBundleTypeName: '.sct encrypted transfer',
      CFBundleTypeRole: 'Viewer',
      LSHandlerRank: 'Owner',
      LSItemContentTypes: ['com.omavashia2005.sct.transfer']
    }],
    UTExportedTypeDeclarations: [{
      UTTypeIdentifier: 'com.omavashia2005.sct.transfer',
      UTTypeDescription: '.sct encrypted transfer',
      UTTypeConformsTo: ['public.data'],
      UTTypeTagSpecification: { 'public.filename-extension': ['sct-transfer'] }
    }]
  },
  electronVersion: electron.version,
  platform: 'darwin',
  arch: process.arch,
  // macOS cannot load a native library from inside the archive.
  asar: { unpack: '*.node' },
  overwrite: true,
  osxSign: {
    identity,
    continueOnError: false,
    // The explicit code-signing policy check replaces osx-sign's basic-policy lookup.
    identityValidation: false,
    type: 'development',
    optionsForFile: () => ({
      // Local certificates lack the Team ID required by library validation.
      entitlements: ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.disable-library-validation'],
      timestamp: 'none'
    })
  }
})

const appPath = join(output, 'sct.app')
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' })
execFileSync('/usr/bin/codesign', [
  '--verify', '-R', `=identifier "${bundleId}" and certificate leaf = H"${identity}"`, appPath
], { stdio: 'inherit' })
console.log(`Signed app: ${appPath}`)
console.log(`Signing certificate: ${identityName} (${identity})`)
