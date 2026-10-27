// 申請書・見積書作成の「🧾 売上伝票」からの受け取り（../src/lib/importRequest.js）。
// お客様の情報は URL に載せず、この端末の localStorage に置いて ?from=shinsei で開く。受け取ったらすぐ消す。

import test from 'node:test'
import assert from 'node:assert/strict'
import { IMPORT_KEY, openedFromShinsei, takeImportRequest } from '../src/lib/importRequest.js'

function memoryStore(init = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    has: (k) => m.has(k),
  }
}

const NOW = Date.UTC(2026, 9, 27, 3, 0, 0)
const request = (sales, createdAt = NOW - 1000) => JSON.stringify({ kind: 'taiyo-uriage-request', v: 1, createdAt, sales })

test('?from=shinsei で開いたときだけ', () => {
  assert.equal(openedFromShinsei('?from=shinsei'), true)
  assert.equal(openedFromShinsei('?from=tokutei'), false)
  assert.equal(openedFromShinsei(''), false)
})

test('受け取って消す・項目をそろえる', () => {
  const store = memoryStore({
    [IMPORT_KEY]: request({
      serviceType: 'specific',
      issueDate: '2026-10-30',
      staff: ' 見本 太郎 ',
      customerName: '見本 花子',
      customerAddress: '福岡県行橋市見本1-2-3',
      officeName: '見本居宅介護支援事業所',
      careManager: '例題 一郎',
      customerType: 'existing',
      billingType: 'receipt',
      careLevel: '介護２',
      userRatio: 0.2,
      remaining: 80000,
      items: [{ amount: 39680, cost: 0, productName: 'シャワーチェア 見本', color: '' }, { amount: 0, productName: '金額なし' }, null],
      miyakoChecked: true,
      showDetail: true,
      welfare: true,
      categories: ['シャワーチェア', 3],
      unknown: 'x',
    }),
  })
  const s = takeImportRequest(store, NOW)
  assert.equal(store.has(IMPORT_KEY), false)
  assert.equal(s.staff, '見本 太郎')
  assert.equal(s.careLevel, '介護２')
  assert.equal(s.userRatio, 0.2)
  assert.equal(s.remaining, 80000)
  assert.deepEqual(s.items, [{ amount: 39680, cost: 0, productName: 'シャワーチェア 見本', color: '' }])
  assert.equal(s.welfare, true)
  assert.deepEqual(s.categories, ['シャワーチェア'])
  assert.equal('unknown' in s, false)
  // 2回目はない
  assert.equal(takeImportRequest(store, NOW), null)
})

test('古いもの・形のちがうもの・壊れたものは読まずに消す', () => {
  for (const raw of [
    request({ customerName: 'x' }, NOW - 11 * 60 * 1000),
    JSON.stringify({ kind: 'taiyo-tokutei-order', v: 1, createdAt: NOW, sales: {} }),
    JSON.stringify({ kind: 'taiyo-uriage-request', v: 2, createdAt: NOW, sales: {} }),
    '{壊れた',
  ]) {
    const store = memoryStore({ [IMPORT_KEY]: raw })
    assert.equal(takeImportRequest(store, NOW), null)
    assert.equal(store.has(IMPORT_KEY), false)
  }
  assert.equal(takeImportRequest(memoryStore(), NOW), null)
})

test('負担割合・介護度・区分のおかしな値は入れない', () => {
  const store = memoryStore({ [IMPORT_KEY]: request({ userRatio: 0.15, careLevel: '要介護2', billingType: 'x', serviceType: 'rental', issueDate: '2026-02-30' }) })
  assert.deepEqual(takeImportRequest(store, NOW), {})
})
