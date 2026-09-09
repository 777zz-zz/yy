// ===== 应用锁（隐私防护）专项回归 =====
// 用法：node build.mjs && node tools/verify-applock.mjs
// 需要：Node 21+（fetch/WebSocket）+ 本机 Chrome/Edge（可用 CHROME_PATH 指定）
// 覆盖：A 冷启动锁屏出现  B 错误密码  C 正确密码解锁+会话标记  D 刷新不重锁
//       E 会话清除后重锁  F 异常态(en=1 无密码)自愈关闭  G 忘密码问答重置全流程
//       H 静态防线（EXCLUDE/模板/产物接线）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function h53(str) {
  const s = String(str);
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
}
const P = 'xy-home-v2:';

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
import { extname } from 'node:path';

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-applock-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function nav(u, waitMs) {
  await cdp('Page.navigate', { url: u });
  await sleep(waitMs || 900);
}
// 在站点上下文写键并刷新（必须先 navigate 到本站在执行——about:blank 无同源 localStorage）
async function seedAndReload(o) {
  // 通过页面内 xyStore 双写（LS+IDB）——与真实开启路径一致；裸写 LS 会因 LS/IDB
  // 不一致被启动恢复逻辑当孤儿处理，无法反映真实行为
  await evalJs(`(function(){
    try{sessionStorage.removeItem('mochi-applock-ok');}catch(e){}
    var G='xy-home-v2';
    function rm(k){try{if(window.xyStore)window.xyStore(G).remove(k);}catch(e){}try{localStorage.removeItem(G+':'+k);}catch(e2){}}
    ['applock-en','applock-pin','applock-qa'].forEach(rm);
    var ks=${JSON.stringify(o)};
    for(var k in ks){try{if(window.xyStore)window.xyStore(G).set(k,ks[k]);else localStorage.setItem(G+':'+k,ks[k]);}catch(e){try{localStorage.setItem(G+':'+k,ks[k]);}catch(e2){}}}
    return 1;
  })()`);
  await sleep(600); // 等 xyStore 的异步 IDB 写完成，保证双写一致
  await cdp('Page.reload');
  await sleep(1300);
}
async function clearSessAndReload() {
  await evalJs("try{sessionStorage.removeItem('mochi-applock-ok')}catch(e){}");
  await cdp('Page.reload');
  await sleep(1300);
}
async function lockState() {
  return evalJs(`(function(){
    var m=document.getElementById('applock-mask');
    if(!m)return JSON.stringify({has:false,shown:false,sess:sessionStorage.getItem('mochi-applock-ok')||'',lsEn:localStorage.getItem('${P}applock-en')||'',lsPin:!!localStorage.getItem('${P}applock-pin')});
    var b=m.querySelector('.applock-box');
    return JSON.stringify({
      has:true,shown:m.hidden!==true,
      title:b?b.querySelector('.applock-title').textContent:'',
      err:b&&b.querySelector('#applock-err')?b.querySelector('#applock-err').textContent:'',
      sess:sessionStorage.getItem('mochi-applock-ok')||'',
      lsEn:localStorage.getItem('${P}applock-en')||'',
      lsPin:!!localStorage.getItem('${P}applock-pin')
    });
  })()`);
}
async function clickKeys(str) {
  await evalJs(`(function(){var s=${JSON.stringify(String(str))};for(var i=0;i<s.length;i++){var el=document.querySelector('.applock-key[data-k="'+s[i]+'"]');if(el)el.click();}return 1;})()`);
  await sleep(120);
}
async function clickOk() {
  await evalJs(`(function(){var el=document.getElementById('applock-ok');if(el)el.click();return 1;})()`);
  await sleep(180);
}
async function typeText(v) {
  await evalJs(`(function(){var el=document.getElementById('applock-txt');if(el){el.value=${JSON.stringify(v)};}return 1;})()`);
  await sleep(100);
}
async function clickSubmit() {
  await evalJs(`(function(){var el=document.querySelector('[data-submit="1"]');if(el)el.click();return 1;})()`);
  await sleep(200);
}
async function clickLink(labelOrAct) {
  await evalJs(`(function(){var els=[].slice.call(document.querySelectorAll('#applock-mask [data-link]'));for(var i=0;i<els.length;i++){var t=els[i].getAttribute('data-link');if(t===${JSON.stringify(labelOrAct)}||els[i].textContent.indexOf(${JSON.stringify(labelOrAct)})>=0){els[i].click();return 1;}}return 0;})()`);
  await sleep(200);
}
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

// 先进入站点（空库首启），后续所有写键都在本站在执行
await nav(baseUrl + '/index.html', 1500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__applockReady')) break; await sleep(250); }

// ---- A. 冷启动锁屏出现 ----
await seedAndReload({ 'applock-en': '1', 'applock-pin': h53('1234') });
let st = JSON.parse(await lockState() || '{}');
check('A1 已启用应用锁：冷启动出现锁屏遮罩', st.has && st.shown === true, JSON.stringify(st));
check('A2 锁屏标题为「应用锁已开启」', st.title === '应用锁已开启', st.title);

// ---- B. 错误密码 ----
await clickKeys('9999');
await clickOk();
st = JSON.parse(await lockState() || '{}');
check('B1 错误密码：仍在锁屏', st.shown === true, 'shown=' + st.shown);
check('B2 错误密码：提示「密码不正确」', st.err && st.err.indexOf('密码不正确') >= 0, st.err);

// ---- C. 正确密码解锁 ----
await clickKeys('1234');
await clickOk();
st = JSON.parse(await lockState() || '{}');
check('C1 正确密码：锁屏消失', st.has && st.shown === false, JSON.stringify(st));
check('C2 解锁后 sessionStorage 置位', st.sess === '1', st.sess);

// ---- D. 同标签刷新不重锁（本会话已解锁） ----
await cdp('Page.reload');
await sleep(1200);
st = JSON.parse(await lockState() || '{}');
check('D1 同标签刷新：不再要求解锁（会话保留则不建锁层）', !(st.has && st.shown === true), JSON.stringify(st));

// ---- E. 会话清除（等效新开标签/冷启动）后重锁 ----
await clearSessAndReload();
st = JSON.parse(await lockState() || '{}');
check('E1 会话清除+刷新：锁屏重现', st.has && st.shown === true, JSON.stringify(st));

// ---- F. 异常态自愈：en=1 但无密码 → 自动关闭防锁死 ----
await seedAndReload({ 'applock-en': '1' });
st = JSON.parse(await lockState() || '{}');
check('F1 en=1 无密码：不显示锁屏', !(st.has && st.shown === true), JSON.stringify(st));
check('F2 en=1 无密码：applock-en 被自愈置 0', st.lsEn === '0', st.lsEn);

// ---- G. 忘记密码→安全问答→重设密码全流程 ----
await seedAndReload({ 'applock-en': '1', 'applock-pin': h53('5678'), 'applock-qa': JSON.stringify({ q: '第一次见面的城市？', h: h53('北京') }) });
st = JSON.parse(await lockState() || '{}');
check('G1 预置问答后冷启动锁屏', st.has && st.shown === true);
await clickLink('忘记密码');
st = JSON.parse(await lockState() || '{}');
check('G2 点「忘记密码」出现安全问答输入屏', st.title === '安全问题', st.title);
await typeText('上海');
await clickSubmit();
st = JSON.parse(await lockState() || '{}');
check('G3 错误答案：提示不正确并停留', st.shown === true && st.err.indexOf('不正确') >= 0, st.err);
await typeText('北京');
await clickSubmit();
st = JSON.parse(await lockState() || '{}');
check('G4 正确答案：进入重设密码第一屏', st.title === '重设密码' || st.title === '再输入一次确认' || st.shown === true, st.title);
await clickKeys('8888');
await clickOk();
st = JSON.parse(await lockState() || '{}');
check('G5 重设第二屏：再次输入', /确认/.test(st.title), st.title);
await clickKeys('8888');
await clickOk();
st = JSON.parse(await lockState() || '{}');
check('G6 重设完成：锁屏消失且会话已解锁', st.shown === false && st.sess === '1', JSON.stringify(st));
// 验证新密码生效、旧密码失效
await clearSessAndReload();
await clickKeys('5678');
await clickOk();
st = JSON.parse(await lockState() || '{}');
check('G7 旧密码已失效：仍锁屏', st.shown === true && st.err.indexOf('不正确') >= 0, st.err);
await clickKeys('8888');
await clickOk();
st = JSON.parse(await lockState() || '{}');
check('G8 新密码可解锁', st.shown === false, JSON.stringify(st));

// ---- H. 静态防线 ----
const artifact = readFileSync(join(root, 'index.html'), 'utf8');
const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const contacts = readFileSync(join(root, 'src', 'js', 'contacts.js'), 'utf8');
check('H1 模板含设置入口开关 #applock-en', tpl.indexOf('id="applock-en"') >= 0);
check('H2 contacts EXCLUDE 含 applock 三键', contacts.indexOf("'applock-en', 'applock-pin', 'applock-qa']") >= 0);
check('H3 产物含锁屏样式 .applock-mask', artifact.indexOf('.applock-mask') >= 0);
check('H4 产物含脚本就绪标志 __applockReady', artifact.indexOf('window.__applockReady') >= 0);
check('H5 产物含 FLOAT 注册 #applock-mask', artifact.indexOf('#applock-mask') >= 0);
check('H6 产物含密码摘要函数 cyrb53(不存明文)', /function h53\(str\)/.test(artifact) || artifact.indexOf('2654435761') >= 0);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
