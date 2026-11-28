'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const asar = require('@electron/asar')
const { verifyPeArchitecture } = require('../scripts/windows-pe')
const { loadApplicationService, makeMockApp, tempDir, SERVICE_PATH } = require('./helpers/mock-electron')

const encoders = { h264: 'libx264', hevc: 'libx265', av1: 'libaom-av1' }
const fragmentFlags = ['-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4']

function prepareFixtures(ffmpeg, directory) {
  fs.mkdirSync(directory, { recursive: true })
  for (const [codec, encoder] of Object.entries(encoders)) {
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=10',
      '-t', '1', '-an', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:v', encoder,
      ...fragmentFlags, path.join(directory, `${codec}.video.tmp`)])
  }
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000',
    '-t', '1', '-vn', '-c:a', 'aac', ...fragmentFlags, path.join(directory, 'sample.audio.tmp')])
}

function verifyFaststart(file) {
  const data = fs.readFileSync(file)
  let hasMoov = false
  for (let offset = 0; offset + 8 <= data.length;) {
    const type = data.toString('ascii', offset + 4, offset + 8)
    const size = data.readUInt32BE(offset)
    // The one-second fixtures only use 32-bit MP4 box sizes.
    assert(size >= 8 && offset + size <= data.length, `Invalid MP4 box: ${type}`)
    if (type === 'moov') hasMoov = true
    if (type === 'mdat') {
      assert(hasMoov, 'MP4 moov must precede mdat')
      return
    }
    offset += size
  }
  assert.fail('MP4 has no mdat box')
}

async function verifyPackage(appDirectory, fixtures, ffprobe, arch) {
  assert.equal(process.platform, 'win32')
  assert.equal(process.arch, arch)
  const resources = path.resolve(appDirectory, 'resources')
  const ffmpeg = path.join(resources, 'ffmpeg', 'ffmpeg.exe')
  verifyPeArchitecture(path.join(appDirectory, 'BiliDownloader.exe'), arch)
  verifyPeArchitecture(ffmpeg, arch)
  verifyPeArchitecture(ffprobe, arch)
  assert(fs.existsSync(path.join(resources, 'ffmpeg', arch === 'arm64' ? 'COPYING.LGPLv2.1' : 'ffmpeg.exe.LICENSE')))
  const archive = path.join(resources, 'app.asar')
  assert(!asar.listPackage(archive).some(file => /[\\/]ff(?:mpeg|probe)\.exe$/i.test(file)),
    'Application archive contains an additional FFmpeg or FFprobe executable')
  const shippedService = asar.extractFile(archive, 'electron/application-service.js').toString('utf8')
  assert.equal(shippedService.replaceAll('\r\n', '\n'), fs.readFileSync(SERVICE_PATH, 'utf8').replaceAll('\r\n', '\n'))

  Object.defineProperty(process, 'resourcesPath', { value: resources })
  const { ApplicationService } = loadApplicationService({ app: makeMockApp({ isPackaged: true }) })
  const service = new ApplicationService()
  const work = tempDir('bili 音视频-')
  try {
    process.env.FFMPEG_BIN = path.join(work, 'unavailable.exe')
    for (const codec of Object.keys(encoders)) {
      const video = path.join(work, `${codec}.video.tmp`)
      const audio = path.join(work, 'sample.audio.tmp')
      const result = path.join(work, `${codec}.part.mp4`)
      fs.copyFileSync(path.join(fixtures, path.basename(video)), video)
      fs.copyFileSync(path.join(fixtures, path.basename(audio)), audio)
      await service.mergeStreams(video, audio, result, new AbortController().signal)
      const { streams } = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries',
        'stream=codec_type,codec_name', '-of', 'json', result], { encoding: 'utf8' }))
      assert.deepEqual(streams.map(stream => [stream.codec_type, stream.codec_name]), [['video', codec], ['audio', 'aac']])
      verifyFaststart(result)
      console.log(`${arch}: ${codec} + AAC → MP4 (faststart)`)
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'fixtures' && args.length === 2) return prepareFixtures(...args)
  if (mode === 'verify' && args.length === 4) return verifyPackage(...args)
  throw new Error('Usage: fixtures <ffmpeg> <fixture dir> | verify <app dir> <fixture dir> <ffprobe> <arch>')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
