// ブラウザのテスト（node --test には入れていない）：申請書・見積書作成の「🧾 売上伝票」から開いたとき・生活保護・共有リンク。
//   npm run build && node test/e2e-import.mjs <画像を置くフォルダ>
// Playwright は PLAYWRIGHT（index.mjs のパス）か /opt/node-tools の既定の場所。localhost 以外の通信は止める。
// Tailwind は CDN（cdn.tailwindcss.com）から読むので、見た目も見たいときは TW_CSS に手元で作った CSS を渡す
// （npx tailwindcss@3 で index.html と src/ から作る）。お客様・担当者は架空の名前。

import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import assert from 'node:assert/strict'

const out = process.argv[2] || 'e2e-out'
mkdirSync(out, { recursive: true })
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/node-tools/node_modules/playwright/index.mjs')
const tw = process.env.TW_CSS ? readFileSync(process.env.TW_CSS, 'utf8') : ''

const dist = new URL('../dist/', import.meta.url).pathname
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/taiyo-uriage-denpyo\//, '')
  const file = join(dist, path || 'index.html')
  if (!existsSync(file) || !file.startsWith(dist)) {
    res.writeHead(404)
    return res.end()
  }
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
})
const port = Number(process.env.E2E_PORT || 5196)
await new Promise((r) => server.listen(port, r))
const base = `http://localhost:${port}/taiyo-uriage-denpyo/`

const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
const KEY = 'taiyo-uriage-import-v1'

async function open(viewport, request, hash = '') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1 })
  await ctx.route(/^https?:\/\/(?!localhost)/, (route) => {
    if (tw && /^https:\/\/cdn\.tailwindcss\.com/.test(route.request().url())) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(tw)}; document.head.appendChild(s); })();` })
    }
    return route.abort()
  })
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  if (request) {
    // 送り手と同じ：この端末の localStorage に置いてから ?from=shinsei で開く
    await page.goto(base)
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify({ kind: 'taiyo-uriage-request', v: 1, createdAt: Date.now(), sales: request })])
    await page.goto(`${base}?from=shinsei`)
  } else {
    await page.goto(`${base}${hash}`)
  }
  await page.getByText('売上伝票発行依頼書（住宅改修・特定福祉用具購入）').first().waitFor()
  return { ctx, page }
}

const specific = {
  serviceType: 'specific',
  issueDate: '2026-10-30',
  staff: '見本 太郎',
  customerName: '見本 花子',
  customerAddress: '福岡県行橋市見本1-2-3',
  officeName: '見本居宅介護支援事業所',
  careManager: '例題 一郎',
  customerType: 'new',
  billingType: 'receipt',
  careLevel: '介護２',
  userRatio: 0.2,
  items: [
    { amount: 26400, cost: 0, productName: '見本シャワーチェア 両ひじ掛け', color: '' },
    { amount: 13280, cost: 0, productName: '見本浴槽台', color: '' },
  ],
  miyakoChecked: false,
  showDetail: true,
  categories: ['シャワーチェア', '浴槽台'],
  welfare: false,
}

// ① 特定福祉用具：受け取った内容が全部入る・依頼は消える・URL から ?from= が消える
{
  const { ctx, page } = await open({ width: 1366, height: 900 }, specific)
  await page.getByText('申請書・見積書作成から読み込みました。').waitFor()
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), null)
  assert.equal(new URL(page.url()).search, '')
  assert.equal(await page.getByPlaceholder('例: 山田太郎').inputValue(), '見本 花子')
  assert.equal(await page.getByPlaceholder('担当者名を入力').inputValue(), '見本 太郎')
  assert.equal(await page.getByPlaceholder('居宅事業所名').inputValue(), '見本居宅介護支援事業所')
  assert.equal(await page.getByPlaceholder('ケアマネ名').inputValue(), '例題 一郎')
  // 明細は2つとも残る（前はサービス区分が変わると useEffect で消えていた）
  const amounts = await page.getByPlaceholder('金額(税込)').evaluateAll((l) => l.map((x) => x.value))
  assert.deepEqual(amounts, ['26400', '13280'])
  const text = await page.locator('main').innerText()
  assert.match(text, /対象内利用者負担額（2割・切り上げ）\s*¥7,936/)
  assert.match(text, /保険者負担額（8割・切り下げ）\s*¥31,744/)
  assert.ok(!text.includes('介護扶助'))
  await page.screenshot({ path: `${out}/01-import-pc.png`, fullPage: true })
  // 読み直しても、もう一度は入らない
  await page.reload()
  await page.getByText('売上伝票発行依頼書（住宅改修・特定福祉用具購入）').first().waitFor()
  assert.equal(await page.getByPlaceholder('例: 山田太郎').inputValue(), '')
  await ctx.close()
}

// ② 生活保護：自己負担は出さず、介護扶助として出す（画面・印刷とも）
{
  const { ctx, page } = await open({ width: 390, height: 844 }, { ...specific, userRatio: 0.1, welfare: true })
  await page.getByText('申請書・見積書作成から読み込みました。').waitFor()
  assert.equal(await page.getByLabel('生活保護').isChecked(), true)
  const text = await page.locator('main').innerText()
  assert.ok(!text.includes('対象内利用者負担額'), text)
  assert.match(text, /介護扶助（生活保護・1割・切り上げ）\s*¥3,968/)
  assert.match(text, /ご利用者お支払い合計\s*¥0/)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390)
  await page.screenshot({ path: `${out}/02-welfare-sp.png`, fullPage: true })
  await page.emulateMedia({ media: 'print' })
  const print = await page.locator('.uriage-print').innerText()
  assert.match(print, /1割（生活保護）/)
  assert.match(print, /介護扶助（生活保護・1割・切り上げ）/)
  assert.ok(!print.includes('対象内利用者負担額'))
  await page.screenshot({ path: `${out}/03-welfare-print.png`, fullPage: true })
  // チェックを外すと自己負担に戻る
  await page.emulateMedia({ media: 'screen' })
  await page.getByLabel('生活保護').uncheck()
  assert.match(await page.locator('main').innerText(), /対象内利用者負担額（1割・切り上げ）\s*¥3,968/)
  await ctx.close()
}

// ③ 住宅改修：1行（工事合計・仕切り）・施工業者
{
  const { ctx, page } = await open({ width: 1366, height: 900 }, {
    serviceType: 'housing',
    issueDate: '2026-11-05',
    staff: '見本 太郎',
    customerName: '見本 花子',
    officeName: '見本居宅介護支援事業所',
    careManager: '例題 一郎',
    customerType: 'existing',
    billingType: 'receipt',
    careLevel: '支援２',
    userRatio: 0.1,
    items: [{ amount: 165000, cost: 112860, productName: '住宅改修工事', color: '' }],
    contractor: '見本工務店',
    welfare: false,
  })
  await page.getByText('申請書・見積書作成から読み込みました。').waitFor()
  assert.equal(await page.getByPlaceholder(/施工業者名を入力|入力 \/ 候補から選択/).inputValue(), '見本工務店')
  assert.deepEqual(await page.getByPlaceholder('仕切り(税込)').evaluateAll((l) => l.map((x) => x.value)), ['112860'])
  const text = await page.locator('main').innerText()
  assert.match(text, /対象内利用者負担額（1割・切り上げ）\s*¥16,500/)
  await page.screenshot({ path: `${out}/04-housing-pc.png`, fullPage: true })
  await ctx.close()
}

// ④ 共有リンク（特定福祉用具）も明細が消えない
{
  const payload = Buffer.from(JSON.stringify({ kind: 'uriage', sales: { ...specific, items: specific.items.map((it, i) => ({ ...it, id: i + 1 })) } })).toString('base64url')
  const { ctx, page } = await open({ width: 1366, height: 900 }, null, `#/uriage?payload=${payload}`)
  await page.getByText('共有リンクから内容を読み込みました。').waitFor()
  assert.deepEqual(await page.getByPlaceholder('金額(税込)').evaluateAll((l) => l.map((x) => x.value)), ['26400', '13280'])
  // 画面のボタンでサービス区分を変えたときは、今までどおり明細を消す
  await page.getByRole('button', { name: '住宅改修', exact: true }).click()
  assert.deepEqual(await page.getByPlaceholder('金額(税込)').evaluateAll((l) => l.map((x) => x.value)), [''])
  await ctx.close()
}

await browser.close()
server.close()
console.log('ok: 申請書・見積書作成から受け取る → 生活保護 → 住宅改修 → 共有リンク')
