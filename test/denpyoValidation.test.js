// 指示書 URI-02 / URI-03 の受入条件をテスト化したもの。
// 「負数、小数円、非数、無限大、空欄、極端な桁数で期待どおりエラーとなり、
//   計算・印刷・PDF・共有へ渡らない」
// 「空帳票と不正金額帳票は全出力経路で停止する」

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseYen, isValidYen, validateDenpyoForOutput } from '../src/lib/denpyoValidation.js'

test('parseYen は負数を受け付けない', () => {
  assert.equal(parseYen(-1), 0)
  assert.equal(parseYen('-1000'), 0)
  assert.equal(parseYen('-1'), 0)
  assert.equal(parseYen('－5000'), 0) // 全角マイナス
  assert.equal(parseYen('ー5000'), 0)
})

test('parseYen は非数・無限大を 0 にする', () => {
  assert.equal(parseYen(NaN), 0)
  assert.equal(parseYen(Infinity), 0)
  assert.equal(parseYen(-Infinity), 0)
  assert.equal(parseYen('abc'), 0)
  assert.equal(parseYen(''), 0)
  assert.equal(parseYen('   '), 0)
  assert.equal(parseYen(null), 0)
  assert.equal(parseYen(undefined), 0)
  assert.equal(parseYen({}), 0)
})

test('parseYen は小数円を整数に丸める', () => {
  assert.equal(parseYen(1000.4), 1000)
  assert.equal(parseYen(1000.5), 1001)
  assert.equal(parseYen('39680.7'), 39681)
})

test('parseYen は全角数字と桁区切りを解釈する', () => {
  assert.equal(parseYen('１２３４'), 1234)
  assert.equal(parseYen('39,680'), 39680)
  assert.equal(parseYen('39，680'), 39680) // 全角カンマ
})

test('parseYen は通常の金額をそのまま通す', () => {
  assert.equal(parseYen(0), 0)
  assert.equal(parseYen(39680), 39680)
  assert.equal(parseYen('80900'), 80900)
})

test('isValidYen は非負の有限整数だけを認める', () => {
  assert.equal(isValidYen(0), true)
  assert.equal(isValidYen(39680), true)
  assert.equal(isValidYen(-1), false)
  assert.equal(isValidYen(1000.5), false)
  assert.equal(isValidYen(NaN), false)
  assert.equal(isValidYen(Infinity), false)
  assert.equal(isValidYen('1000'), false)
})

const validSlip = {
  staff: '担当太郎',
  customerName: '顧客花子',
  items: [{ amount: 39680, cost: 20000 }],
  total: 39680,
  remaining: '',
}

test('正しい伝票は出力できる', () => {
  const result = validateDenpyoForOutput(validSlip)
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
})

test('担当者・顧客名の未入力を検出する', () => {
  assert.deepEqual(
    validateDenpyoForOutput({ ...validSlip, staff: '', customerName: '  ' }).errors.slice(0, 2),
    ['担当者', '顧客名']
  )
})

test('明細が空の伝票は出力できない（URI-03）', () => {
  const result = validateDenpyoForOutput({ ...validSlip, items: [{ amount: 0, cost: 0 }], total: 0 })
  assert.equal(result.ok, false)
  assert.ok(result.errors.includes('金額が入った明細が1件も入力されていません'))
  assert.ok(result.errors.includes('売上金額の合計が0円です'))
})

test('明細が1件も無い伝票は出力できない', () => {
  const result = validateDenpyoForOutput({ ...validSlip, items: [], total: 0 })
  assert.equal(result.ok, false)
})

test('負の金額を含む伝票は出力できない（URI-02）', () => {
  const result = validateDenpyoForOutput({
    ...validSlip,
    items: [{ amount: -5000, cost: 0 }],
    total: -5000,
  })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('金額に使えない値')))
})

test('負の仕切りを含む伝票は出力できない', () => {
  const result = validateDenpyoForOutput({
    ...validSlip,
    items: [{ amount: 39680, cost: -100 }],
  })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('仕切りに使えない値')))
})

test('小数・非数の金額を含む伝票は出力できない', () => {
  assert.equal(validateDenpyoForOutput({ ...validSlip, items: [{ amount: 100.5 }], total: 100.5 }).ok, false)
  assert.equal(validateDenpyoForOutput({ ...validSlip, items: [{ amount: NaN }], total: NaN }).ok, false)
  assert.equal(validateDenpyoForOutput({ ...validSlip, items: [{ amount: Infinity }], total: Infinity }).ok, false)
})

test('介護保険残高の未入力は許容し、不正値は拒否する', () => {
  assert.equal(validateDenpyoForOutput({ ...validSlip, remaining: '' }).ok, true)
  assert.equal(validateDenpyoForOutput({ ...validSlip, remaining: 0 }).ok, true)
  assert.equal(validateDenpyoForOutput({ ...validSlip, remaining: 200000 }).ok, true)
  assert.equal(validateDenpyoForOutput({ ...validSlip, remaining: -1 }).ok, false)
  assert.equal(validateDenpyoForOutput({ ...validSlip, remaining: 'abc' }).ok, false)
  assert.equal(validateDenpyoForOutput({ ...validSlip, remaining: 1.5 }).ok, false)
})

test('極端な桁数でも破綻しない', () => {
  const huge = Number.MAX_SAFE_INTEGER
  assert.equal(validateDenpyoForOutput({ ...validSlip, items: [{ amount: huge }], total: huge }).ok, true)
  assert.equal(parseYen(Number.MAX_SAFE_INTEGER + 1), Number.MAX_SAFE_INTEGER + 1)
})
