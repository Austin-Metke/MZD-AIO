/* jshint esversion:8, -W033, -W117, -W097 */
'use strict'
/**
 * File helpers built on Node's fs module. They replace the copy-dir,
 * appender, crlf and rimraf packages and keep the behaviour the tweak
 * builder relied on.
 */
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { Readable } = require('stream')
const extractZip = require('extract-zip')

function fileType (stats) {
  if (stats.isDirectory()) return 'directory'
  if (stats.isFile()) return 'file'
  if (stats.isSymbolicLink()) return 'symbolicLink'
  return ''
}

async function copyRecursive (from, to, filter) {
  const stats = await fsp.lstat(from)
  const type = fileType(stats)
  if (filter && !filter(type, from, path.dirname(from), path.basename(from))) return
  if (type === 'directory') {
    await fsp.mkdir(to, { recursive: true })
    for (const entry of await fsp.readdir(from)) {
      await copyRecursive(path.join(from, entry), path.join(to, entry), filter)
    }
  } else if (type === 'file') {
    // Write the contents rather than using fs.copyFile: copyFile also copies
    // the file mode, and chmod fails with EPERM on FAT32 USB drives on Linux.
    await fsp.writeFile(to, await fsp.readFile(from))
  } else {
    throw new Error(`Cannot copy ${from}: unsupported file type`)
  }
}

/**
 * Recursively copy `from` into `to`, merging into existing folders and
 * overwriting files (copy-dir compatible).
 * copydir(from, to, [filter], callback)
 * filter(type, filepath) returns false to skip an entry, type is
 * 'file' | 'directory' | 'symbolicLink'.
 */
function copydir (from, to, filter, callback) {
  if (typeof callback !== 'function') {
    callback = filter
    filter = null
  }
  copyRecursive(from, to, filter).then(() => callback(null), callback)
}

/**
 * Concatenate files into a readable stream, each followed by a newline
 * (appender compatible). Paths that don't exist are skipped and folders
 * contribute the files directly inside them.
 */
function appendFiles (sources) {
  const files = []
  for (const source of sources) {
    if (!fs.existsSync(source)) continue
    if (fs.statSync(source).isDirectory()) {
      for (const file of fs.readdirSync(source)) {
        const filepath = path.join(source, file)
        if (fs.statSync(filepath).isFile()) files.push(filepath)
      }
    } else {
      files.push(source)
    }
  }
  return Readable.from(files.map((file) => fs.readFileSync(file, 'utf8') + '\n'))
}

/**
 * Convert a file's line endings to LF. Like crlf.set, the callback gets the
 * ending the file had before conversion: 'LF', 'CRLF', 'CR' or 'NA'.
 */
function convertToLF (file, callback) {
  fs.readFile(file, 'utf8', (err, data) => {
    if (err) return callback(err)
    const match = data.match(/\r\n|\r|\n/)
    const ending = match ? { '\r\n': 'CRLF', '\r': 'CR', '\n': 'LF' }[match[0]] : 'NA'
    if (ending === 'LF' || ending === 'NA') return callback(null, ending)
    const converted = data.replace(ending === 'CRLF' ? /\r\n/g : /\r/g, '\n')
    fs.writeFile(file, converted, (err) => callback(err || null, ending))
  })
}

// Retries cover Windows, where Explorer or antivirus briefly hold files open
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 3 }

/** rm -rf. Calls back when done if a callback is given, otherwise runs synchronously. */
function removePath (target, callback) {
  if (typeof callback === 'function') {
    fs.rm(target, RM_OPTIONS, (err) => callback(err || null))
  } else {
    fs.rmSync(target, RM_OPTIONS)
  }
}

/**
 * Delete everything in `dir` matching the glob `pattern` (forward slashes).
 * The pattern is resolved against `dir`, so characters such as ( or [ in
 * the user's folder path are never treated as glob syntax.
 */
function removeMatching (dir, pattern) {
  for (const match of fs.globSync(pattern.replace(/\/$/, ''), { cwd: dir })) {
    fs.rmSync(path.join(dir, match), RM_OPTIONS)
  }
}

/** extract(zipPath, { dir }, callback). extract-zip 2 is promise-only and needs an absolute dir. */
function extract (src, options, callback) {
  extractZip(src, { ...options, dir: path.resolve(options.dir) }).then(() => callback(null), callback)
}

module.exports = { copydir, appendFiles, convertToLF, removePath, removeMatching, extract }
