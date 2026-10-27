// 負担額の計算（../src/lib/denpyoCalc.js）。生活保護（ユーザーの指示「生活保護にチェックしたら自己負担は出さない」2026-10-27）と、
// 3割の保険者負担が1円少なくなっていた不具合（0.7 をかけて切り下げていた）の直し。

import test from 'node:test'
import assert from 'node:assert/strict'
import { calculate, ratioTenths } from '../src/lib/denpyoCalc.js'

const one = (amount) => [{ amount }]

test('ratioTenths は 0.1・0.2・0.3 と 1・2・3 を 1・2・3 にする', () => {
  assert.equal(ratioTenths(0.1), 1)
  assert.equal(ratioTenths(0.2), 2)
  assert.equal(ratioTenths(0.3), 3)
  assert.equal(ratioTenths(3), 3)
  assert.equal(ratioTenths('x'), 0)
})

test('利用者負担は切り上げ・保険者負担は残り（足すと保険対象金額）', () => {
  for (const r of [0.1, 0.2, 0.3]) {
    for (const total of [1, 9, 90, 170, 39680, 80900, 99999, 100001]) {
      const c = calculate({ items: one(total), total, remaining: '', userRatio: r, miyako: false, isSelfPay: false })
      assert.equal(c.userBurden, Math.ceil((total * Math.round(r * 10)) / 10))
      assert.equal(c.userBurden + c.insurerBurden, total, `${total} ${r}`)
    }
  }
  // 前は Math.floor(90 × 0.7) ＝ 62（1円少ない）
  assert.equal(calculate({ items: one(90), total: 90, remaining: '', userRatio: 0.3 }).insurerBurden, 63)
})

test('残高を超えた分は実費で、ご利用者お支払い合計に入る', () => {
  const c = calculate({ items: one(120000), total: 120000, remaining: 100000, userRatio: 0.1 })
  assert.deepEqual([c.insuranceCovered, c.excess, c.userBurden, c.insurerBurden, c.totalUserBurden], [100000, 20000, 10000, 90000, 30000])
})

test('生活保護：自己負担は 0 で、負担割合の分は介護扶助', () => {
  const c = calculate({ items: one(39680), total: 39680, remaining: '', userRatio: 0.1, welfare: true })
  assert.equal(c.userBurden, 0)
  assert.equal(c.aid, 3968)
  assert.equal(c.insurerBurden, 35712)
  assert.equal(c.totalUserBurden, 0)
  const over = calculate({ items: one(120000), total: 120000, remaining: 100000, userRatio: 0.1, welfare: true })
  assert.equal(over.totalUserBurden, 20000) // 残高を超えた分だけ
})

test('個別切り上げ：明細ごとに切り上げて足す', () => {
  const items = [{ amount: 12345 }, { amount: 6789 }]
  const c = calculate({ items, total: 19134, remaining: '', userRatio: 0.1, miyako: true })
  assert.equal(c.userBurden, 1235 + 679)
  assert.equal(c.insurerBurden, 19134 - 1914)
})

test('全額自費は保険を使わない', () => {
  const c = calculate({ items: one(5000), total: 5000, remaining: '', userRatio: 0.1, isSelfPay: true, welfare: true })
  assert.deepEqual([c.insuranceCovered, c.userBurden, c.aid, c.insurerBurden, c.totalUserBurden], [0, 0, 0, 0, 5000])
})
