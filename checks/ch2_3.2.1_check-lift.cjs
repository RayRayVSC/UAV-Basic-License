/* No npm dependencies. Run: node 0.0.1.0/checks/ch2_3.2.1_check-lift.cjs
   Uses installed Chrome headlessly and puts screenshots in the OS temp directory. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {makeModel} = require('../ch2_3.2.1_lift-flow.js');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function checkPhysics() {
  let previous = -Infinity;
  for (const angle of [0, 3, 6, 9, 12]) {
    const model = makeModel(angle);
    assert(model.cl > previous, 'Lift increases with angle in the attached-flow model');
    previous = model.cl;
    assert(model.sample(3, 0).v < 0, 'The downstream flow turns downward');
    assert(model.surfaceSample(1.5).cp < model.surfaceSample(4.72).cp, 'Upper pressure is lower');
    assert.equal(model.sample(0, 0.1), null, 'No velocity field inside the wing');
    let lift = 0, drag = 0;
    for (let i = 0; i < 2000; i++) {
      const theta = (i + 0.5) * Math.PI / 1000;
      const point = model.surfaceSample(theta);
      assert(Math.abs(point.u * point.nx + point.v * point.ny) < 0.001, 'Flow does not penetrate the surface');
      const a = model.surface(theta - Math.PI / 2000), b = model.surface(theta + Math.PI / 2000);
      lift += point.cp * (b.x - a.x); drag -= point.cp * (b.y - a.y);
    }
    assert(Math.abs(lift / model.chord - model.cl) < 0.001, 'Integrated pressure agrees with circulation lift');
    assert(Math.abs(drag / model.chord) < 0.001, 'Ideal potential flow has negligible drag');
  }
  console.log('PASS: pressure integration, lift trend, surface boundary and downward wake');
}

class CDP {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.events = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, {once: true});
      this.ws.addEventListener('error', reject, {once: true});
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(message.result);
      } else this.events.push(message);
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(`CDP timed out: ${method}`));}, 10000);
      this.pending.set(id, {resolve, reject, timer});
      this.ws.send(JSON.stringify({id, method, params}));
    });
  }
  async evaluate(expression) {
    const reply = await this.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
    return reply.result.value;
  }
}

async function main() {
  checkPhysics();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lift-preview-'));
  const profile = path.join(directory, 'chrome-profile');
  const executable = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {windowsHide: true, stdio: 'ignore'});
  let client;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await pause(100);
    assert(fs.existsSync(portFile), 'Chrome remote debugging starts');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    client = new CDP(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
    await client.send('Page.enable'); await client.send('Runtime.enable'); await client.send('Network.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 720, deviceScaleFactor: 1, mobile: false});
    const url = pathToFileURL(path.resolve(__dirname, '../ch2p13_3.2.1_Lift_Pressure_Difference.html')).href;
    await client.send('Page.navigate', {url});
    for (let i = 0; i < 100; i++) {
      if (await client.evaluate("document.getElementById('airflow')?.dataset.angle === '6'")) break;
      await pause(100);
    }
    assert.equal(await client.evaluate("document.getElementById('airflow').dataset.angle"), '6');
    const capture = async (name) => {
      const result = await client.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true});
      fs.writeFileSync(path.join(directory, name), Buffer.from(result.data, 'base64'));
    };
    const click = (id) => client.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const image = () => client.evaluate("document.getElementById('airflow').toDataURL()");
    await pause(300);
    await capture('desktop.png');
    console.log('Desktop geometry:', await client.evaluate("JSON.stringify({stage:document.getElementById('stage').getBoundingClientRect().toJSON(),canvas:document.getElementById('airflow').getBoundingClientRect().toJSON(),footer:document.querySelector('.lesson-foot').getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth})"));
    assert(await client.evaluate("document.getElementById('stage').getBoundingClientRect().height <= 720"), 'Desktop composition fits the 1280×720 template');
    const moving = await image(); await pause(200); assert.notEqual(await image(), moving, 'Airflow animates');
    await click('play-pause'); await pause(100);
    const frozen = await image(); await pause(200); assert.equal(await image(), frozen, 'Pause freezes the canvas');
    await client.evaluate("document.querySelector('[data-angle=\"12\"]').click()"); await pause(150);
    assert.equal(await client.evaluate("document.getElementById('angle').value"), '12');
    assert.equal(await client.evaluate("document.getElementById('airflow').dataset.step"), '3');
    assert.notEqual(await image(), frozen, 'Paused angle changes still redraw');
    await capture('angle-12.png');
    await client.evaluate("document.querySelector('[data-angle=\"0\"]').click()"); await pause(100);
    assert((await client.evaluate("document.getElementById('caption-title').textContent")).includes('仍然可以產生升力'));
    await client.evaluate("document.getElementById('angle').focus()");
    await client.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39});
    await client.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39});
    await pause(100);
    assert.equal(await client.evaluate("document.getElementById('angle').value"), '1', 'Keyboard arrow controls slider');
    for (let i = 0; i < 4; i++) {
      await client.evaluate(`document.querySelector('[data-step="${i}"]').click()`); await pause(50);
      assert.equal(await client.evaluate("document.getElementById('airflow').dataset.step"), String(i));
    }
    await click('next-step'); assert.equal(await client.evaluate("document.getElementById('prev-step').disabled"), true);
    await click('show-notes'); assert.equal(await client.evaluate("document.getElementById('notes-dialog').open"), true);
    await client.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
    await client.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
    assert.equal(await client.evaluate("document.getElementById('notes-dialog').open"), false);
    await click('replay'); await pause(100);
    assert.equal(await client.evaluate("document.getElementById('angle').value"), '6');
    assert.equal(await client.evaluate("document.getElementById('airflow').dataset.step"), '0');
    await pause(7400);
    assert.equal(await client.evaluate("document.getElementById('airflow').dataset.step"), '1', 'Guided replay advances');
    await click('play-pause');
    console.log('PASS: animation, pause, angle presets, slider keyboard, four steps, dialog and guided replay');

    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [375, 812], [500, 900], [667, 375]]) {
      await client.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
      await pause(200);
      assert.equal(await client.evaluate('document.documentElement.scrollWidth > innerWidth'), false, `No horizontal overflow at ${width}px`);
      if (width === 375) {await client.evaluate("document.querySelector('[data-step=\"2\"]').click()"); await pause(100); await capture('mobile.png');}
    }
    await client.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
    await client.send('Page.reload'); await pause(500);
    assert.equal(await client.evaluate("document.getElementById('play-label').textContent"), '播放');
    const reduced = await image(); await pause(200); assert.equal(await image(), reduced, 'Reduced motion starts paused');
    await click('replay'); await pause(100);
    assert.equal(await client.evaluate("document.getElementById('play-label').textContent"), '播放', 'Reduced motion replay stays paused');
    await click('play-pause'); await pause(200); assert.notEqual(await image(), reduced, 'Reduced motion allows explicit playback');
    const errors = client.events.filter((event) => event.method === 'Runtime.exceptionThrown');
    const failed = client.events.filter((event) => event.method === 'Network.loadingFailed');
    assert.equal(errors.length, 0, JSON.stringify(errors)); assert.equal(failed.length, 0, JSON.stringify(failed));
    console.log('PASS: responsive layouts, reduced motion, offline assets, no browser errors');
    console.log('SCREENSHOTS:', directory);
  } finally {
    if (client) {
      try {await client.send('Browser.close');} catch (_) {}
      client.ws.close();
    }
    if (browser.exitCode === null) browser.kill();
  }
}
main().catch((error) => {console.error(error); process.exitCode = 1;});
