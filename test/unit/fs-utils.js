'use strict'

const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { copydir, appendFiles, convertToLF, removePath, removeMatching, extract } = require('../../app/lib/fs-utils')

const tweaks = path.join(__dirname, '..', '..', 'app', 'files', 'tweaks')
const call = (fn, ...args) => new Promise((resolve, reject) => fn(...args, (err, value) => err ? reject(err) : resolve(value)))
const read = (file) => fs.readFileSync(file, 'utf8')

describe('(unit) fs-utils', () => {
  let tmp

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aio-fs-utils-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function makeTree (root, files) {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      fs.writeFileSync(path.join(root, rel), content)
    }
  }

  describe('copydir', () => {
    it('merges into an existing folder and overwrites files', async () => {
      makeTree(path.join(tmp, 'src'), { 'a.txt': 'new', 'sub/b.txt': 'b' })
      makeTree(path.join(tmp, 'dest'), { 'a.txt': 'old', 'keep.txt': 'keep' })
      await call(copydir, path.join(tmp, 'src'), path.join(tmp, 'dest'))
      expect(read(path.join(tmp, 'dest/a.txt'))).to.equal('new')
      expect(read(path.join(tmp, 'dest/sub/b.txt'))).to.equal('b')
      expect(read(path.join(tmp, 'dest/keep.txt'))).to.equal('keep')
    })

    it('skips entries the filter rejects', async () => {
      makeTree(path.join(tmp, 'src'), { 'img/a.png': 'png', 'img/a.txt': 'txt' })
      const pngOnly = (type, filepath) => !(type === 'file' && path.extname(filepath) !== '.png')
      await call(copydir, path.join(tmp, 'src'), path.join(tmp, 'dest'), pngOnly)
      expect(fs.existsSync(path.join(tmp, 'dest/img/a.png'))).to.equal(true)
      expect(fs.existsSync(path.join(tmp, 'dest/img/a.txt'))).to.equal(false)
    })

    it('reports a missing source folder', async () => {
      const err = await call(copydir, path.join(tmp, 'missing'), path.join(tmp, 'dest')).catch((e) => e)
      expect(err.code).to.equal('ENOENT')
    })
  })

  describe('appendFiles', () => {
    it('joins files in order, each followed by a newline, skipping missing paths', async () => {
      makeTree(tmp, { 'one.txt': 'one', 'two.txt': 'two\n', 'dir/three.txt': 'three' })
      const out = path.join(tmp, 'out.txt')
      const stream = fs.createWriteStream(out)
      appendFiles([path.join(tmp, 'one.txt'), path.join(tmp, 'missing.txt'), path.join(tmp, 'dir'), path.join(tmp, 'two.txt')]).pipe(stream)
      await new Promise((resolve) => stream.on('close', resolve))
      expect(read(out)).to.equal('one\nthree\ntwo\n\n')
    })
  })

  describe('convertToLF', () => {
    for (const [ending, content] of [['CRLF', 'a\r\nb\r\n'], ['CR', 'a\rb\r'], ['LF', 'a\nb\n']]) {
      it(`converts ${ending} files and reports the original ending`, async () => {
        const file = path.join(tmp, 'f.sh')
        fs.writeFileSync(file, content)
        expect(await call(convertToLF, file)).to.equal(ending)
        expect(read(file)).to.equal('a\nb\n')
      })
    }

    it('reports NA for a file without line endings', async () => {
      const file = path.join(tmp, 'f.sh')
      fs.writeFileSync(file, 'abc')
      expect(await call(convertToLF, file)).to.equal('NA')
    })
  })

  describe('removePath / removeMatching', () => {
    it('removes a folder synchronously or with a callback', async () => {
      makeTree(tmp, { 'a/x.txt': 'x', 'b/y.txt': 'y' })
      removePath(path.join(tmp, 'a'))
      await call(removePath, path.join(tmp, 'b'))
      expect(fs.readdirSync(tmp)).to.deep.equal([])
    })

    it('removes glob matches relative to a folder whose name has glob characters', () => {
      const dir = path.join(tmp, 'User (Work) [1]')
      makeTree(dir, { 'a.md': '', 'run.sh': '', '02-start-adb/x': '', '02-start-wifiAP/x': '', 'sub/b.md': '' })
      removeMatching(dir, '**/*.md')
      removeMatching(dir, '*-start-adb/')
      expect(fs.readdirSync(dir).sort()).to.deep.equal(['02-start-wifiAP', 'run.sh', 'sub'])
      expect(fs.readdirSync(path.join(dir, 'sub'))).to.deep.equal([])
    })
  })

  describe('extract', () => {
    it('unzips a bundled theme into a relative target folder', async () => {
      const zip = path.join(tweaks, 'config', 'themes', 'Floating.zip')
      const dest = path.relative(process.cwd(), path.join(tmp, 'theme'))
      await call(extract, zip, { dir: dest })
      expect(fs.existsSync(path.join(tmp, 'theme', 'jci'))).to.equal(true)
    })

    it('refuses archives that write through a symlink entry', async () => {
      // 'link' -> ../escaped.txt, then a file entry named 'link'
      const zip = path.join(__dirname, '..', 'fixtures', 'symlink-escape.zip')
      fs.mkdirSync(path.join(tmp, 'dest'))
      const err = await call(extract, zip, { dir: path.join(tmp, 'dest') }).catch((e) => e)
      expect(err.message).to.include('Refusing to extract symlink')
      expect(fs.existsSync(path.join(tmp, 'escaped.txt'))).to.equal(false)
    })
  })
})
