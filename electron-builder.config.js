module.exports = {
  appId: 'com.bilibilidown.app',
  productName: 'BilibiliDown',
  copyright: 'Copyright © 2024 BilibiliDown Team',
  
  directories: {
    output: 'dist-electron',
    buildResources: 'electron/build'
  },
  
  files: [
    'electron/**',
    'frontend/dist/**'
  ],

  asar: true,
  
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
    shortcutName: 'BilibiliDown'
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
    maintainer: 'BilibiliDown Team'
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
    repo: 'bilibilidown'
  },
  
  npmRebuild: false,
  
  nodeGypRebuild: false,
  
  buildDependenciesFromSource: false,
  
  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/'
  }
}