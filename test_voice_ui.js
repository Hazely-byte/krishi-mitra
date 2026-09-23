'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const SCREENSHOT_DIR = path.resolve(__dirname, 'test_screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });

    this.ws.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.id && this.pending.has(parsed.id)) {
        const { resolve, reject } = this.pending.get(parsed.id);
        this.pending.delete(parsed.id);
        if (parsed.error) reject(new Error(parsed.error.message));
        else resolve(parsed.result);
      }
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setViewport(width, height, deviceScaleFactor = 2, isMobile = true) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: isMobile
    });
    await this.send('Emulation.setVisibleSize', { width, height });
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await sleep(1200);
  }

  async evaluate(expression) {
    return await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
  }

  async captureScreenshot(filepath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    fs.writeFileSync(filepath, buffer);
    console.log(`Saved screenshot: ${path.basename(filepath)} (${buffer.length} bytes)`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runTests() {
  console.log('🚀 Starting headless Chrome for Voice UI testing...');
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--user-data-dir=' + path.resolve(__dirname, '.chrome-test-profile')
  ]);

  let connected = false;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      await fetchJson(`http://localhost:${PORT}/json/version`);
      connected = true;
      break;
    } catch (e) {}
  }

  if (!connected) {
    console.error('Failed to connect to Chrome debugging port.');
    chromeProc.kill();
    process.exit(1);
  }

  console.log('✅ Chrome debugging port connected.');
  const targets = await fetchJson(`http://localhost:${PORT}/json/list`);
  const pageTarget = targets.find(t => t.type === 'page') || targets[0];

  const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
  await client.connect();
  console.log('✅ CDP WebSocket connected.');

  await client.send('Page.enable');
  await client.send('DOM.enable');
  await client.send('Runtime.enable');

  const viewports = [
    { name: '360x800', w: 360, h: 800 },
    { name: '390x844', w: 390, h: 844 },
    { name: '412x915', w: 412, h: 915 }
  ];

  // 1. Test Idle State across all 3 breakpoints
  console.log('\n--- 1. Testing Idle State ---');
  for (const vp of viewports) {
    await client.setViewport(vp.w, vp.h);
    await client.navigate('http://localhost:3000/ai-help.html?mode=voice');
    
    // Check DOM elements state
    const check = await client.evaluate(`({
      hasVoiceActive: document.body.classList.contains('voice-mode-active'),
      isBottomNavHidden: getComputedStyle(document.querySelector('.bottom-nav')).display === 'none',
      isModeBarHidden: getComputedStyle(document.getElementById('ai-mode-bar')).display === 'none',
      hasIdlePrompt: !!document.querySelector('.voice-idle-prompt'),
      hasMicStrip: !!document.querySelector('.voice-mic-strip'),
      hasTranscriptCard: !!document.getElementById('voice-transcript-card')
    })`);
    console.log(`Viewport ${vp.name} DOM check:`, check.result.value);

    await client.captureScreenshot(path.join(SCREENSHOT_DIR, `voice_idle_${vp.name}.png`));
  }

  // 2. Test Raipur vs Neora Paddy Comparison Template across all 3 breakpoints
  console.log('\n--- 2. Testing Two-Way Comparison Template ---');
  for (const vp of viewports) {
    await client.setViewport(vp.w, vp.h);
    await client.navigate('http://localhost:3000/ai-help.html?mode=voice');
    await client.evaluate('window.renderTestComparison()');
    // Wait for staggered entrance animations to settle (duration ~1s)
    await sleep(1500);

    const checkTpl = await client.evaluate(`({
      cardsCount: document.querySelectorAll('.tpl-comparison-card').length,
      buttonsCount: document.querySelectorAll('.tpl-comparison-btn').length,
      leftTitle: document.querySelector('.tpl-comparison-column[data-side="left"] .tpl-card-title')?.textContent,
      rightTitle: document.querySelector('.tpl-comparison-column[data-side="right"] .tpl-card-title')?.textContent,
      containerOverflow: getComputedStyle(document.getElementById('voice-interactive-canvas')).overflow
    })`);
    console.log(`Viewport ${vp.name} Template check:`, checkTpl.result.value);

    await client.captureScreenshot(path.join(SCREENSHOT_DIR, `voice_template_${vp.name}.png`));
  }

  // 3. Test Selection State (Click card / button)
  console.log('\n--- 3. Testing Selection Interaction ---');
  await client.setViewport(390, 844);
  await client.navigate('http://localhost:3000/ai-help.html?mode=voice');
  await client.evaluate('window.renderTestComparison()');
  await sleep(1500);

  // Click the Raipur APMC button
  const clickResult = await client.evaluate(`(() => {
    let firedEvent = null;
    document.addEventListener('krishi:template-action', e => {
      firedEvent = e.detail;
    }, { once: true });

    const btn = document.querySelector('.tpl-comparison-btn');
    btn.click();

    return {
      eventPayload: firedEvent,
      isLeftSelected: document.querySelector('.tpl-comparison-card[data-id="raipur_apmc"]').classList.contains('selected'),
      isRightDimmed: document.querySelector('.tpl-comparison-card[data-id="neora_apmc"]').classList.contains('dimmed'),
      areButtonsDisabled: Array.from(document.querySelectorAll('.tpl-comparison-btn')).every(b => b.disabled),
      transcriptText: document.getElementById('voice-transcript-card').textContent
    };
  })()`);
  console.log('Selection interaction result:', clickResult.result.value);
  await sleep(500);
  await client.captureScreenshot(path.join(SCREENSHOT_DIR, 'voice_selection_390x844.png'));

  // 4. Test Hindi Devanagari Typography
  console.log('\n--- 4. Testing Hindi Language (Devanagari) ---');
  await client.setViewport(390, 844);
  await client.navigate('http://localhost:3000/ai-help.html?mode=voice&lang=hi');
  await sleep(800);
  await client.captureScreenshot(path.join(SCREENSHOT_DIR, 'voice_idle_hindi_390x844.png'));

  const hindiTestData = {
    template: 'two_way_comparison',
    left: {
      id: 'raipur_apmc',
      title: 'रायपुर मंडी (Raipur)',
      badge: 'निकटतम',
      rows: [
        { label: 'मॉडल भाव', value: '₹2,180 / क्विंटल', highlight: true },
        { label: 'दूरी', value: '12 किमी' },
        { label: 'आवक', value: '450 टन' },
        { label: 'किस्म', value: 'धान (सामान्य)' }
      ]
    },
    right: {
      id: 'neora_apmc',
      title: 'नेवरा मंडी (Neora)',
      badge: 'सर्वश्रेष्ठ दर',
      rows: [
        { label: 'मॉडल भाव', value: '₹2,260 / क्विंटल', highlight: true },
        { label: 'दूरी', value: '38 किमी' },
        { label: 'आवक', value: '120 टन' },
        { label: 'किस्म', value: 'धान (सामान्य)' }
      ]
    },
    buttons: [
      { targetId: 'raipur_apmc', label: 'रायपुर चुनें', voiceTurn: 'मैंने रायपुर मंडी चुनी' },
      { targetId: 'neora_apmc', label: 'नेवरा चुनें', voiceTurn: 'मैंने नेवरा मंडी चुनी' }
    ]
  };

  await client.evaluate(`window.KrishiTemplates.renderComparison(document.getElementById('voice-interactive-canvas'), ${JSON.stringify(hindiTestData)})`);
  await sleep(1500);
  await client.captureScreenshot(path.join(SCREENSHOT_DIR, 'voice_template_hindi_390x844.png'));

  // Cleanup
  console.log('\n🏁 Tests complete! Cleaning up...');
  client.close();
  chromeProc.kill();
  try {
    fs.rmSync(path.resolve(__dirname, '.chrome-test-profile'), { recursive: true, force: true });
  } catch (e) {}

  console.log('✅ All tests finished successfully.');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
