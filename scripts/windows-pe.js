'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')

function verifyPeArchitecture(file, arch) {
  const expected = { x64: 0x8664, arm64: 0xaa64 }[arch]
  assert(expected, `Unsupported Windows architecture: ${arch}`)
  const fd = fs.openSync(file, 'r')
  try {
    const dos = Buffer.alloc(64)
    assert(fs.readSync(fd, dos, 0, dos.length, 0) === dos.length && dos.toString('ascii', 0, 2) === 'MZ',
      `Invalid DOS header: ${file}`)
    const pe = Buffer.alloc(6)
    assert(fs.readSync(fd, pe, 0, pe.length, dos.readUInt32LE(0x3c)) === pe.length && pe.readUInt32LE(0) === 0x4550,
      `Invalid PE header: ${file}`)
    const machine = pe.readUInt16LE(4)
    assert.equal(machine, expected, `${file} has PE machine 0x${machine.toString(16)}, expected ${arch}`)
  } finally {
    fs.closeSync(fd)
  }
}

module.exports = { verifyPeArchitecture }
