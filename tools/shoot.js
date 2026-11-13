/**
 * 截图工具：用 Chrome DevTools Protocol 精确控制视口、模拟手机、整页截图。
 * 用法：node tools/shoot.js <url> <输出文件> [选项]
 *   --w 390 --h 844        视口尺寸（CSS px）
 *   --full                 整页截图
 *   --dsf 2                像素比
 *   --eval "js"            截图前执行的脚本（可重复）
 *   --wait 400             每次 eval 后等待毫秒
 *   --port 9222            调试端口
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

function parseArgs(argv) {
  const out = { evals: [], w: 390, h: 844, dsf: 2, full: false, wait: 400, port: 9222, profile: 'hx-shoot-profile' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--full') out.full = true;
    else if (a === '--w') out.w = +argv[++i];
    else if (a === '--h') out.h = +argv[++i];
    else if (a === '--dsf') out.dsf = +argv[++i];
    else if (a === '--wait') out.wait = +argv[++i];
    else if (a === '--port') out.port = +argv[++i];
    else if (a === '--profile') out.profile = argv[++i];
    else if (a === '--eval') out.evals.push(argv[++i]);
    else rest.push(a);
  }
  out.url = rest[0];
  out.output = rest[1];
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForEndpoint(port, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch (e) {}
    await sleep(200);
  }
  throw new Error('调试端口未就绪');
}

async function firstPageTarget(port) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    const list = await res.json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) return page;
    await sleep(200);
  }
  throw new Error('找不到可用的页面目标');
}

function cdpConnection(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      (listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error('WebSocket 连接失败')));
  });

  return {
    ready,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(fn);
    },
    close() { ws.close(); }
  };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.output) {
    console.error('用法: node tools/shoot.js <url> <output.png> [--w 390] [--h 844] [--full] [--eval "js"]');
    process.exit(2);
  }

  const exe = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('找不到 Edge / Chrome');

  const profile = path.join(os.tmpdir(), args.profile);
  const child = spawn(
    exe,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      `--remote-debugging-port=${args.port}`,
      `--user-data-dir=${profile}`,
      'about:blank'
    ],
    { stdio: 'ignore', detached: false }
  );

  try {
    await waitForEndpoint(args.port);
    const target = await firstPageTarget(args.port);
    const cdp = cdpConnection(target.webSocketDebuggerUrl);
    await cdp.ready;

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: args.w,
      height: args.h,
      deviceScaleFactor: args.dsf,
      mobile: args.w < 700
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: args.w < 700, maxTouchPoints: 5 });

    await cdp.send('Page.navigate', { url: args.url });
    await sleep(1200);

    for (const script of args.evals) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: script,
        awaitPromise: true,
        returnByValue: true
      });
      if (result.exceptionDetails) {
        console.error('eval 出错:', result.exceptionDetails.text, result.exceptionDetails.exception?.description || '');
      } else if (result.result && result.result.value !== undefined && result.result.value !== null) {
        console.log('eval →', result.result.value);
      }
      await sleep(args.wait);
    }

    // 收集页面错误
    const errors = await cdp.send('Runtime.evaluate', {
      expression: 'window.__hxErrors ? window.__hxErrors.join(" | ") : ""',
      returnByValue: true
    });
    if (errors.result.value) console.error('页面错误:', errors.result.value);

    let clip;
    if (args.full) {
      const metrics = await cdp.send('Page.getLayoutMetrics');
      const size = metrics.cssContentSize || metrics.contentSize;
      clip = { x: 0, y: 0, width: args.w, height: Math.ceil(size.height), scale: 1 };
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: args.w,
        height: Math.ceil(size.height),
        deviceScaleFactor: args.dsf,
        mobile: args.w < 700
      });
      await sleep(250);
    }

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: args.full,
      ...(clip ? { clip } : {})
    });

    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, Buffer.from(shot.data, 'base64'));
    console.log('已保存', args.output);
    cdp.close();
  } finally {
    child.kill();
    await sleep(300);
  }
})().catch((err) => {
  console.error('截图失败:', err.message);
  process.exit(1);
});
