'use strict'

// Launches the real app with Playwright and compiles a small set of tweaks.
// Settings and output live in a temp folder. Headless Linux needs a display:
// run under xvfb-run.
const { expect } = require('chai')
const { _electron: electron } = require('playwright-core')
const fs = require('fs')
const os = require('os')
const path = require('path')
const pjson = require('../../app/package.json')

const repo = path.join(__dirname, '..', '..')
const tweaks = path.join(repo, 'app', 'files', 'tweaks')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe('(integration) MZD-AIO-TI', function () {
  this.timeout(120000)

  let tmp, out, app, page
  const pageErrors = []

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aio-integration-'))
    out = path.join(tmp, 'out')
    const userData = path.join(tmp, 'userData')
    const cwd = path.join(tmp, 'run')
    fs.mkdirSync(out)
    fs.mkdirSync(userData)
    fs.mkdirSync(cwd)
    // Dev builds resolve tweak files from ./app and write the HTML compile log
    // two folders above it, so run from a temp folder that links to app/ (and
    // to color-schemes/, which the app looks for next to itself)
    fs.symlinkSync(path.join(repo, 'app'), path.join(cwd, 'app'), 'junction')
    fs.symlinkSync(path.join(repo, 'color-schemes'), path.join(cwd, 'color-schemes'), 'junction')
    // Point _copy_to_usb at the temp folder and skip the first-run dialogs
    fs.writeFileSync(path.join(userData, 'aio-persist.json'), JSON.stringify({
      copyFolderLocation: out, visits: 1, updateVer: 286, updated: true
    }))

    app = await electron.launch({
      executablePath: require('electron'),
      args: ['./app', `--user-data-dir=${userData}`],
      cwd
    })
    page = await app.firstWindow()
    page.on('pageerror', (err) => pageErrors.push(err.message))
    await page.waitForSelector('#compileButton')
  })

  after(async () => {
    if (app) await app.close()
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('opens the main window with the tweak list', async () => {
    expect(await page.evaluate(() => document.querySelector('#mzd-title').innerText)).to.include(`v${pjson.version}`)
    expect(await page.evaluate(() => document.querySelectorAll('input[id^="IN"]').length)).to.be.above(10)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).to.equal(true)
    expect(pageErrors).to.deep.equal([])
  })

  // Tick the given checkboxes, start a compile and wait for it to finish
  async function compile (selectors) {
    await page.reload()
    await page.waitForSelector('#compileButton')
    await page.evaluate((ids) => {
      for (const id of ids) document.querySelector(id).click()
      document.querySelector('#compileButton').click()
    }, selectors)
    await page.waitForSelector('.confirmCompile .btn-success')
    await page.evaluate(() => document.querySelector('.confirmCompile .btn-success').click())

    let finished = false
    for (let i = 0; i < 90 && !finished; i++) {
      await sleep(1000)
      finished = await page.evaluate(() => {
        // Never copy to a real USB drive from a test: decline the offer
        const usbPrompt = document.querySelector('.copytoUSB1, .copytoUSBMulti')
        if (usbPrompt) usbPrompt.querySelector('[data-bb-handler="cancel"]').click()
        const noUsb = document.querySelector('.compFinishBox')
        if (noUsb) noUsb.querySelector('[data-bb-handler="ok"]').click()
        return !!document.querySelector('.finishedMessage')
      })
    }
    expect(finished, 'compile finished').to.equal(true)
    expect(await page.evaluate(() => window.errFlag), 'compile error flag').to.equal(false)
  }

  it('compiles the selected tweaks into _copy_to_usb', async () => {
    await compile(['#IN1', '#backupJCI']) // Touchscreen while moving, JCI backup

    const script = fs.readFileSync(path.join(out, '_copy_to_usb', 'tweaks.sh'), 'utf8')
    expect(script).to.not.include('\r\n')
    for (const tweak of ['00_intro.txt', '00_backup.txt', '01_touchscreen-i.txt', '00_end.txt']) {
      const content = fs.readFileSync(path.join(tweaks, tweak), 'utf8').replace(/\r\n/g, '\n')
      expect(script, tweak).to.include(content)
    }
    expect(pageErrors).to.deep.equal([])
  })

  it('wraps tweaks not tested on v74 so tweaks.sh skips them there', async () => {
    await compile(['#IN6', '#IN24']) // Improved list loop, Castscreen-receiver (+ WiFi & SSH by default)

    const script = fs.readFileSync(path.join(out, '_copy_to_usb', 'tweaks.sh'), 'utf8')
    const tweak = (name) => fs.readFileSync(path.join(tweaks, name), 'utf8').replace(/\r\n/g, '\n')
    expect(script).to.include(`if install_allowed "CASTSCREEN-RECEIVER"\nthen\n\n${tweak('24_castscreen-i.txt')}\nfi\n`)
    expect(script).to.include(`if install_allowed "ENABLE WIFI"\nthen\n\n${tweak('00_wifi.txt')}\nfi\n`)
    expect(script).to.include(`if install_allowed "SSH_BRINGBACK"\nthen\n\n${tweak('00_sshbringback.txt')}\nfi\n`)
    // List loop has been tested on v74 so it is not wrapped
    expect(script).to.include(tweak('06_listloop-i.txt'))
    expect(script.match(/install_allowed "/g)).to.have.lengthOf(3)
    expect(pageErrors).to.deep.equal([])
  })

  it('applies a color scheme from the bundled color-schemes pack', async () => {
    await compile(['#colors', '#color1']) // Blue
    const blue = path.join(out, '_copy_to_usb', 'config', 'color-schemes', 'Blue')
    expect(fs.existsSync(path.join(blue, 'jci', 'gui')), 'unzipped Blue/jci.zip').to.equal(true)
    expect(fs.existsSync(path.join(blue, '_skin_jci_bluedemo.zip')), 'Blue navigation skin').to.equal(true)
    expect(pageErrors).to.deep.equal([])
  })
})
