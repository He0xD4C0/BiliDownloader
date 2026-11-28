const fs = require('node:fs')
const path = require('node:path')
const { Arch } = require('builder-util')
const { verifyPeArchitecture } = require('./scripts/windows-pe')
const appFiles = ['electron/**', 'frontend/dist/**']

module.exports = {
  appId: 'com.bilidownloader.app',
  productName: 'BiliDownloader',
  
  directories: {
    output: 'dist-electron',
    buildResources: 'electron/build'
  },
  
  files: [
    ...appFiles,
    'node_modules/ffmpeg-static/**'
  ],

  asar: true,
  asarUnpack: [
    'node_modules/ffmpeg-static/**'
  ],

  beforePack({ arch, electronPlatformName, packager }) {
    if (electronPlatformName !== 'win32') return
    const targetArch = Arch[arch]
    const staging = path.join(packager.projectDir, 'dist-electron', `ffmpeg-win-${targetArch}`)
    if (targetArch === 'x64') {
      const source = path.dirname(require.resolve('ffmpeg-static/package.json'))
      fs.mkdirSync(staging, { recursive: true })
      for (const file of ['ffmpeg.exe', 'ffmpeg.exe.LICENSE', 'ffmpeg.exe.README']) {
        fs.copyFileSync(path.join(source, file), path.join(staging, file))
      }
    }
    const binary = path.join(staging, 'ffmpeg.exe')
    const license = path.join(staging, targetArch === 'arm64' ? 'COPYING.LGPLv2.1' : 'ffmpeg.exe.LICENSE')
    if (targetArch === 'arm64' && (!fs.existsSync(binary) || !fs.existsSync(license))) {
      throw new Error('Windows ARM64 FFmpeg is missing. Run scripts/build-win-arm64-ffmpeg.sh from Linux or WSL.')
    }
    verifyPeArchitecture(binary, targetArch)
  },
  
  win: {
    files: [...appFiles, '!node_modules/ffmpeg-static/**'],
    extraResources: [{
      from: 'dist-electron/ffmpeg-win-${arch}',
      to: 'ffmpeg',
      filter: ['ffmpeg.exe', 'ffmpeg.exe.LICENSE', 'ffmpeg.exe.README', 'COPYING.LGPLv2.1']
    }],
    target: [
      {
        target: 'portable',
        arch: ['x64', 'arm64']
      }
    ],
    artifactName: '${productName}-${version}-windows-${arch}.${ext}',
    icon: 'electron/build/icon.ico'
  },
  
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'BiliDownloader'
  },
  
  mac: {
    target: ['dmg'],
    artifactName: '${productName}-${version}-macos-${arch}.${ext}',
    icon: 'electron/build/icon.icns',
    category: 'public.app-category.utilities',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'electron/build/entitlements.mac.plist',
    entitlementsInherit: 'electron/build/entitlements.mac.plist'
  },
  
  linux: {
    target: ['AppImage'],
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
    icon: 'electron/build/icon.png',
    category: 'Utility',
    maintainer: 'BiliDownloader Team'
  },
  
  dmg: {
    contents: [
      {
        x: 410,
        y: 150,
        type: 'link',
        path: '/Applications'
      },
      {
        x: 130,
        y: 150,
        type: 'file'
      }
    ]
  },
  
  publish: null,
  
  npmRebuild: false,
  
  nodeGypRebuild: false,
  
  buildDependenciesFromSource: false,
  
  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/'
  }
}
