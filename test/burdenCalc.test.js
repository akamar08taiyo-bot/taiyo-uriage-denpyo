import test from 'node:test'
import assert from 'node:assert/strict'
import { calculate } from '../src/lib/burdenCalc.js'

const run = (total, userRatio, extra = {}) =>
  calculate({ items: [{ amount: total }], total, remaining: '', userRatio, miyako: false, isSelfPay: false, ...extra })

test('利用者負担額＋保険者負担額は保険対象金額と一致する（1〜3割、小数誤差なし）', () => {
  for (const ratio of [0.1, 0.2, 0.3]) {
    for (let total = 1000; total <= 200000; total += 1) {
      const r = run(total, ratio)
      assert.equal(r.userBurden + r.insurerBurden, total, `${ratio} ${total}`)
    }
  }
})

test('3割負担で 44,000円 は 13,200円／30,800円（以前は保険者負担が1円少なかった）', () => {
  const r = run(44000, 0.3)
  assert.equal(r.userBurden, 13200)
  assert.equal(r.insurerBurden, 30800)
})

test('端数は利用者負担を切り上げ・保険者負担を切り下げ', () => {
  const r = run(12345, 0.1)
  assert.equal(r.userBurden, 1235)
  assert.equal(r.insurerBurden, 11110)
})

test('介護保険残高を超える分は超過分として全額利用者負担', () => {
  const r = calculate({ items: [{ amount: 150000 }], total: 150000, remaining: 100000, userRatio: 0.1, miyako: false, isSelfPay: false })
  assert.equal(r.insuranceCovered, 100000)
  assert.equal(r.excess, 50000)
  assert.equal(r.userBurden, 10000)
  assert.equal(r.insurerBurden, 90000)
  assert.equal(r.totalUserBurden, 60000)
})

test('個別切り上げは明細ごとに利用者負担を切り上げる（超過なし）', () => {
  const items = [{ amount: 12345 }, { amount: 6789 }]
  const r = calculate({ items, total: 19134, remaining: '', userRatio: 0.3, miyako: true, isSelfPay: false })
  assert.equal(r.userBurden, Math.ceil(12345 * 3 / 10) + Math.ceil(6789 * 3 / 10))
  assert.equal(r.userBurden + r.insurerBurden, 19134)
})

test('全額自費は保険対象0円・全額超過', () => {
  const r = run(30000, 0.1, { isSelfPay: true })
  assert.equal(r.insuranceCovered, 0)
  assert.equal(r.totalUserBurden, 30000)
})

test('個別切り上げ＋限度額超過：超過分を利用者負担額に二重に含めない', () => {
  // 明細 60,000円＋60,000円、残高 100,000円、1割 → 保険対象 100,000円（60,000＋40,000）
  const r = calculate({ items: [{ amount: 60000 }, { amount: 60000 }], total: 120000, remaining: 100000, userRatio: 0.1, miyako: true, isSelfPay: false })
  assert.equal(r.excess, 20000)
  assert.equal(r.userBurden, 10000)
  assert.equal(r.insurerBurden, 90000)
  assert.equal(r.totalUserBurden, 30000)
})

test('個別切り上げ：超過がなければ従来どおり明細ごとに切り上げ', () => {
  const r = calculate({ items: [{ amount: 12345 }, { amount: 6789 }], total: 19134, remaining: '', userRatio: 0.1, miyako: true, isSelfPay: false })
  assert.equal(r.userBurden, 1235 + 679)
  assert.equal(r.userBurden + r.insurerBurden, 19134)
})

test('償還払いはご利用者お支払い合計＝総合計、保険者負担分は後日の払い戻し', () => {
  const r = calculate({ items: [{ amount: 150000 }], total: 150000, remaining: 100000, userRatio: 0.1, miyako: false, isSelfPay: false, reimbursement: true })
  assert.equal(r.totalUserBurden, 150000)
  assert.equal(r.refund, 90000)
  const r2 = calculate({ items: [{ amount: 150000 }], total: 150000, remaining: 100000, userRatio: 0.1, miyako: false, isSelfPay: false, reimbursement: false })
  assert.equal(r2.totalUserBurden, 60000)
  assert.equal(r2.refund, 0)
})
