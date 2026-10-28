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

async function open(viewport, request, hash = '', device = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, ...device.context })
  if (device.init) await ctx.addInitScript(...device.init)
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

// ② 生活保護：自己負担は出さず、負担割合の分を「対象内利用者負担額（生活保護・…）」として出す（画面・印刷とも。「介護扶助」とは書かない＝ユーザーの指示 2026-10-28）
{
  const { ctx, page } = await open({ width: 390, height: 844 }, { ...specific, userRatio: 0.1, welfare: true })
  await page.getByText('申請書・見積書作成から読み込みました。').waitFor()
  assert.equal(await page.getByLabel('生活保護').isChecked(), true)
  const text = await page.locator('main').innerText()
  assert.ok(!text.includes('介護扶助'), text)
  assert.match(text, /対象内利用者負担額（生活保護・1割・切り上げ）\s*¥3,968/)
  assert.match(text, /ご利用者お支払い合計\s*¥0/)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390)
  await page.screenshot({ path: `${out}/02-welfare-sp.png`, fullPage: true })
  await page.emulateMedia({ media: 'print' })
  const print = await page.locator('.uriage-print').innerText()
  assert.match(print, /1割（生活保護）/)
  assert.match(print, /対象内利用者負担額（生活保護・1割・切り上げ）/)
  assert.ok(!print.includes('介護扶助'))
  // 印刷の利用者負担額・保険者負担額の行は黄色くしない（項目名はほかの行と同じ薄い緑・税込は色なし。ユーザーの指示「1割の税込の部分は黄色くしなくてもよい」、9割の行も「やめます」2026-10-28）
  const bgs = await page.locator('.uriage-print tr', { hasText: '負担額' }).evaluateAll((rows) =>
    rows.map((r) => [r.cells[0].textContent.trim(), getComputedStyle(r.cells[0]).backgroundColor, getComputedStyle(r.cells[1]).backgroundColor]),
  )
  assert.deepEqual(bgs, [
    ['対象内利用者負担額（生活保護・1割・切り上げ）', 'rgb(236, 253, 245)', 'rgba(0, 0, 0, 0)'],
    ['保険者負担額（9割・切り下げ）', 'rgb(236, 253, 245)', 'rgba(0, 0, 0, 0)'],
  ])
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

// ⑤ メール（PDF付き）：パソコンでは PDF を保存して、メールのソフトで宛先・件名・本文の入った新しいメールを開く（mailto:）。宛先はマスタ設定
//    （ユーザーの依頼 2026-10-27「メールでそのまま、PDFかもしくは、Excelの資料送れる機能…添付とメールの文面の作成をワンタッチで」。
//    前の .eml は Edge が「デバイスに問題を起こす可能性があります」と止めた 2026-10-28）。上の段は 印刷・保存・メール・設定 だけ
// mailto: を開いた（メールのソフトに渡した）ことを覚える。ブラウザのテストではほかのアプリを開かない
const catchMailto = () => {
  window.__mailto = []
  const click = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.href.startsWith('mailto:')) return void window.__mailto.push(this.href)
    return click.call(this)
  }
}
const readMailto = (url) => {
  const [head, query] = url.replace(/^mailto:/, '').split('?')
  return { to: head, ...Object.fromEntries(query.split('&').map((kv) => kv.split('=')).map(([k, v]) => [k, decodeURIComponent(v)])) }
}
{
  const { ctx, page } = await open({ width: 1366, height: 900 }, specific, '', { init: [catchMailto] })
  await page.getByText('申請書・見積書作成から読み込みました。').waitFor()
  const bar = page.getByRole('group', { name: '操作' })
  assert.deepEqual(await bar.getByRole('button').allInnerTexts(), ['🖨 印刷', '💾 保存', '✉ メール', '⚙ 設定'])
  await bar.getByRole('button', { name: '⚙ 設定' }).click()
  await page.getByLabel('メールの宛先').fill('jimu@example.co.jp')
  await page.getByLabel('メールの CC').fill('kanri@example.co.jp')
  await page.screenshot({ path: `${out}/05-mail-settings.png` })
  await page.getByRole('button', { name: '保存して反映' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), bar.getByRole('button', { name: '✉ メール' }).click()])
  assert.match(dl.suggestedFilename(), /^2026-10-30_見本 花子_売上伝票発行依頼書\.pdf$/, dl.suggestedFilename())
  await dl.saveAs(`${out}/mail.pdf`)
  const pdf = readFileSync(await dl.path())
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
  assert.ok(pdf.length > 20000, String(pdf.length))
  await page.waitForFunction(() => window.__mailto.length === 1)
  const url = (await page.evaluate(() => window.__mailto))[0]
  assert.ok(url.length <= 2000, `mailto: は ${url.length} 字（Edge・Chrome は Windows で 2048 字まで）`)
  const mail = readMailto(url)
  assert.equal(mail.to, 'jimu%40example.co.jp')
  assert.equal(mail.cc, 'kanri@example.co.jp')
  assert.equal(mail.subject, '売上伝票発行のご依頼 見本 花子様')
  for (const t of ['添付の通り、売上伝票の発行をお願いいたします。', '顧客名：見本 花子 様', 'サービス区分：特定福祉用具', '施工（納品予定日）：2026-10-30']) assert.ok(mail.body.includes(t), mail.body)
  await page.getByText('PDFを保存して、メールを開きました。PDFをメールに添付してください。').waitFor()
  await page.screenshot({ path: `${out}/05-mail.png` })
  // 共有リンク・空白の状態に戻すは、下の「🖨 印刷」の下にある
  await page.getByRole('button', { name: '共有リンク' }).waitFor()
  await page.getByRole('button', { name: '空白の状態に戻す' }).waitFor()
  // 読み直しても宛先は覚えている
  await page.reload()
  await page.getByRole('button', { name: '⚙ 設定' }).click()
  assert.equal(await page.getByLabel('メールの宛先').inputValue(), 'jimu@example.co.jp')
  await ctx.close()
}

// ⑤-2 入力がそろっていなくてもメールは作れる（ユーザーの指示「すべて入力しなくても、メールでとばせるようにする」2026-10-28）。PDF保存は今までどおり止める
{
  const { ctx, page } = await open({ width: 1366, height: 900 }, null, '', { init: [catchMailto] })
  const bar = page.getByRole('group', { name: '操作' })
  let downloads = 0
  page.on('download', () => downloads++)
  await bar.getByRole('button', { name: '💾 保存' }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(downloads, 0, '保存（PDF）は止める')
  const [dl] = await Promise.all([page.waitForEvent('download'), bar.getByRole('button', { name: '✉ メール' }).click()])
  assert.match(dl.suggestedFilename(), /\.pdf$/)
  await page.waitForFunction(() => window.__mailto.length === 1)
  assert.equal(readMailto((await page.evaluate(() => window.__mailto))[0]).subject, '売上伝票発行のご依頼')
  await ctx.close()
}

// ⑥ タブレット（ユーザーの話「タブレットからもおくります」）：PDFでメールは共有メニュー（メールのアプリ）に PDF と件名・本文を渡す。
//    iPad（名前はパソコンの Mac と同じ）と、Android のタブレットの「PC版サイト」の表示（名前は Linux のパソコン）。
//    PDF を作っているあいだに押した操作の続きと見なされなくなった（iPad の Safari など）ときは「📤 メールのアプリに渡す」をもう一度押す
{
  // 共有メニューのかわり：渡されたものを覚える。notAllowed 回だけ「押した操作の続きではない」と断る
  const shareStub = (notAllowed) => {
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 })
    window.__shared = []
    let refuse = notAllowed
    navigator.canShare = (d) => !!d?.files?.length
    navigator.share = async (d) => {
      if (refuse-- > 0) throw new DOMException('not allowed', 'NotAllowedError')
      const files = await Promise.all(d.files.map(async (f) => ({ name: f.name, type: f.type, head: new TextDecoder().decode((await f.arrayBuffer()).slice(0, 5)) })))
      window.__shared.push({ title: d.title, text: d.text, files })
    }
  }
  const tablets = [
    ['ipad', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 0],
    ['android', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 1],
  ]
  for (const [name, userAgent, refuse] of tablets) {
    const { ctx, page } = await open({ width: 1180, height: 820 }, specific, '', { context: { userAgent, hasTouch: true }, init: [shareStub, refuse] })
    await page.getByText('申請書・見積書作成から読み込みました。').waitFor()
    let downloaded = false
    page.on('download', () => (downloaded = true))
    await page.getByRole('group', { name: '操作' }).getByRole('button', { name: '✉ メール' }).click()
    if (refuse) {
      const again = page.getByRole('dialog', { name: 'メールのアプリに渡す' })
      await again.waitFor()
      await page.screenshot({ path: `${out}/06-mail-tablet-tap.png` })
      await again.getByRole('button', { name: '📤 メールのアプリに渡す' }).click()
      await again.waitFor({ state: 'detached' })
    }
    await page.getByText('メールのアプリに渡しました。').waitFor()
    const shared = await page.evaluate(() => window.__shared)
    assert.equal(shared.length, 1, name)
    assert.equal(shared[0].title, '売上伝票発行のご依頼 見本 花子様')
    for (const t of ['添付の通り、売上伝票の発行をお願いいたします。', '顧客名：見本 花子 様']) assert.ok(shared[0].text.includes(t), shared[0].text)
    assert.equal(shared[0].files.length, 1)
    assert.match(shared[0].files[0].name, /\.pdf$/)
    assert.equal(shared[0].files[0].type, 'application/pdf')
    assert.equal(shared[0].files[0].head, '%PDF-')
    assert.equal(downloaded, false, `${name}：ファイルは保存しない（共有メニューで添付まで渡す）`)
    await page.screenshot({ path: `${out}/06-mail-tablet-${name}.png` })
    await ctx.close()
  }
}

await browser.close()
server.close()
console.log('ok: 申請書・見積書作成から受け取る → 生活保護 → 住宅改修 → 共有リンク → メール（パソコン・入力がそろっていなくても・タブレット）')
