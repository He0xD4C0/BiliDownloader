module.exports = {
  appId: 'com.bilidownloader.app',
  productName: 'BiliDownloader',
  copyright: 'Copyright © 2024 BiliDownloader Team',
  
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
        target: 'nsis',
        arch: ['x64', 'ia32']
      },
      {
        target: 'portable',
        arch: ['x64', 'ia32']
      }
    ],
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
    target: ['dmg', 'zip'],
    icon: 'electron/build/icon.icns',
    category: 'public.app-category.utilities',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'electron/build/entitlements.mac.plist',
    entitlementsInherit: 'electron/build/entitlements.mac.plist'
  },
  
  linux: {
    target: ['AppImage', 'deb', 'rpm'],
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
    owner: 'yourusername',
    repo: 'bilidownloader'
  },
  
  npmRebuild: false,
  
  nodeGypRebuild: false,
  
  buildDependenciesFromSource: false,
  
  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/'
  }
}