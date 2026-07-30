module.exports = {
  appId: 'com.bilidownloader.app',
  productName: 'BiliDownloader',
  copyright: 'Copyright 2026 He0xD4C0',
  
  directories: {
    output: 'dist-electron',
    buildResources: 'electron/build'
  },
  
  files: [
    'electron/**',
    'frontend/dist/**',
    'node_modules/ffmpeg-static/**'
  ],

  asar: true,
  asarUnpack: [
    'node_modules/ffmpeg-static/**'
  ],
  
  win: {
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
  
  publish: {
    provider: 'github',
    owner: 'He0xD4C0',
    repo: 'BiliDownloader'
  },
  
  npmRebuild: false,
  
  nodeGypRebuild: false,
  
  buildDependenciesFromSource: false,
  
  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/'
  }
}