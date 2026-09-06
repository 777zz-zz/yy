// ===== 验证 #239：互动功能字卡页列表被「使用概率」框挤没（小米15Pro/Chrome 报障） =====
// #132 概率框（13 行 stepper ~794px）插在 fc 页头部 + .card-list{flex:1;overflow-y:auto}
// 的 flex 最小尺寸归 0 → 列表压成 6px、首屏全在视口外=「字卡看不到了，点击没内容」。
// 修复：概率框移到列表下方（template.html）+ fc/dk 页整页滚动规则（chat-pages.css）。
// 用法：node tools/verify-fun-cards-layout.mjs（需先 node build.mjs）
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(desc, ok, detail) { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 384, height: 808 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });
await page.waitForTimeout(200);

// F1 打开 fc 页：首屏（视口内）存在可见字卡条目
const f1 = await page.evaluate(() => {
  document.getElementById('li-fun-cards').click();
  const vpH = innerHeight;
  const items = [...document.querySelectorAll('#fc-list .cc-item')];
  const inVp = items.filter(it => { const r = it.getBoundingClientRect(); return r.top < vpH && r.bottom > 0 && r.height > 0; });
  return { total: items.length, inVp: inVp.length, firstTop: items.length ? Math.round(items[0].getBoundingClientRect().top) : -1 };
});
check('F1 打开fc页首屏存在可见字卡条目', f1.total > 0 && f1.inVp > 0, JSON.stringify(f1));

// F2 概率框位于列表之后（DOM 序）
const f2 = await page.evaluate(() => {
  const box = document.getElementById('dcf-prob-box'), list = document.getElementById('fc-list');
  if (!box || !list) return { ok: false };
  return { ok: !!(box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_PRECEDING), rows: box.querySelectorAll('.gs-row').length };
});
check('F2 概率框在列表下方(DOM序)且13行俱全', f2.ok && f2.rows === 13, JSON.stringify(f2));

// F3 列表不再塌缩（高度远大于修复前的 6px）
const f3 = await page.evaluate(() => {
  const el = document.getElementById('fc-list');
  return { rectH: Math.round(el.getBoundingClientRect().height), scrollH: el.scrollHeight, pageScrollH: document.getElementById('page-fun-cards').scrollHeight };
});
check('F3 fc列表高度不再塌缩(>200px)', f3.rectH > 200, JSON.stringify(f3));

// F4 点分组 chip 列表内容即时变化
const f4 = await page.evaluate(() => {
  const bar = document.getElementById('fc-groups-bar');
  const chips = [...bar.children];
  const before = document.getElementById('fc-list').querySelectorAll('.cc-item').length;
  if (chips.length < 2) return { ok: false };
  chips[1].click();
  return { ok: true, chips: chips.length, before };
});
await page.waitForTimeout(300);
const f4b = await page.evaluate(() => ({ after: document.getElementById('fc-list').querySelectorAll('.cc-item').length }));
check('F4 点分组chip列表内容变化(有反馈)', f4.ok && f4b.after > 0 && f4b.after !== f4.before, JSON.stringify(f4) + '→' + JSON.stringify(f4b));

// F5 tab 切换正常
const f5 = await page.evaluate(() => {
  const tab = document.querySelector('#fc-tabs .cc-tab[data-type="eat"]');
  if (!tab) return { ok: false };
  tab.click();
  return { ok: true };
});
await page.waitForTimeout(300);
const f5b = await page.evaluate(() => {
  const items = [...document.querySelectorAll('#fc-list .cc-item')];
  const r = items.length ? items[0].getBoundingClientRect() : null;
  return { n: items.length, firstTop: r ? Math.round(r.top) : -1 };
});
check('F5 切吃饭tab列表正常渲染', f5.ok && f5b.n > 0, JSON.stringify(f5b));

// F6 dc 页不回归（dc 页本就是「设置区高、整页滚动」设计——判据是列表不塌缩+页面可滚到列表，不判首屏）
const f6 = await page.evaluate(() => {
  document.getElementById('fc-back').click();
  const li = document.getElementById('li-default-cards');
  if (!li) return { ok: false };
  li.click();
  return { ok: true };
});
await page.waitForTimeout(400);
const f6b = await page.evaluate(() => {
  const list = document.getElementById('dc-list');
  const r = list.getBoundingClientRect();
  const items = list.querySelectorAll('.cc-item');
  return { n: items.length, rectH: Math.round(r.height), scrollH: list.scrollHeight, pageScrollH: document.getElementById('page-default-cards').scrollHeight, pageClientH: document.getElementById('page-default-cards').clientHeight };
});
check('F6 dc页列表不回归(不塌缩+整页可滚到列表)', f6.ok && f6b.n > 0 && f6b.rectH > 200 && f6b.pageScrollH > f6b.pageClientH, JSON.stringify(f6b));

// F7 静态锚：chat-pages.css 整页滚动规则 + dk 页同构
const f7css = readFileSync(join(root, 'src/css/chat-pages.css'), 'utf8');
check('F7 静态锚：fc/dk 整页滚动规则在源', f7css.indexOf('#page-fun-cards #fc-list { flex:0 0 auto; overflow:visible; min-height:0;') >= 0 && f7css.indexOf('#page-deskcheck #dk-list { flex:0 0 auto; overflow:visible; min-height:0;') >= 0);

await browser.close();
server.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
