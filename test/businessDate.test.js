// 指示書 COMMON-01 / URI-01 の受入条件をテスト化したもの。
// 「JSTの日付変更前後で画面・印刷・PDF名が常に同じ当日になる」
// 「非実在日付を拒否し、うるう年の2月29日は受理する」

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  todayInTokyo,
  currentBusinessMonth,
  isValidDateString,
  formatDateString,
  tokyoParts,
} from '../src/lib/businessDate.js'

// UTC時刻を固定して、日本時間での業務日を検証する。
const at = (iso) => new Date(iso)

test('JSTの日付変更直後でも当日を返す（UTCではまだ前日）', () => {
  // JST 2026-08-14 00:00 は UTC 2026-08-13 15:00
  assert.equal(todayInTokyo(at('2026-08-13T15:00:00Z')), '2026-08-14')
  // JST 2026-08-14 08:59 は UTC 2026-08-13 23:59（従来はここで前日になっていた）
  assert.equal(todayInTokyo(at('2026-08-13T23:59:00Z')), '2026-08-14')
  // JST 2026-08-14 09:00 は UTC 2026-08-14 00:00
  assert.equal(todayInTokyo(at('2026-08-14T00:00:00Z')), '2026-08-14')
})

test('日付変更の直前はまだ前日を返す', () => {
  // JST 2026-08-13 23:59 は UTC 2026-08-13 14:59
  assert.equal(todayInTokyo(at('2026-08-13T14:59:00Z')), '2026-08-13')
})

test('月初の深夜でも当月を返す', () => {
  // JST 2026-09-01 00:01 は UTC 2026-08-31 15:01
  assert.equal(currentBusinessMonth(at('2026-08-31T15:01:00Z')), '2026-09')
  assert.equal(todayInTokyo(at('2026-08-31T15:01:00Z')), '2026-09-01')
  // JST 2026-08-31 23:59 はまだ8月
  assert.equal(currentBusinessMonth(at('2026-08-31T14:59:00Z')), '2026-08')
})

test('年末年始をまたいでも正しい年を返す', () => {
  // JST 2027-01-01 00:30 は UTC 2026-12-31 15:30
  assert.equal(todayInTokyo(at('2026-12-31T15:30:00Z')), '2027-01-01')
  assert.equal(currentBusinessMonth(at('2026-12-31T15:30:00Z')), '2027-01')
})

test('うるう日を正しく扱う', () => {
  // JST 2028-02-29 01:00 は UTC 2028-02-28 16:00
  assert.equal(todayInTokyo(at('2028-02-28T16:00:00Z')), '2028-02-29')
})

test('tokyoParts は 1〜12 の月を返す', () => {
  assert.deepEqual(tokyoParts(at('2026-08-13T15:00:00Z')), { year: 2026, month: 8, day: 14 })
})

test('formatDateString はゼロ埋めする', () => {
  assert.equal(formatDateString(2026, 8, 1), '2026-08-01')
  assert.equal(formatDateString(2026, 12, 31), '2026-12-31')
})

test('存在しない日付を拒否する', () => {
  assert.equal(isValidDateString('2026-02-31'), false)
  assert.equal(isValidDateString('2026-02-30'), false)
  assert.equal(isValidDateString('2026-02-29'), false) // 2026年はうるう年ではない
  assert.equal(isValidDateString('2026-04-31'), false)
  assert.equal(isValidDateString('2026-13-01'), false)
  assert.equal(isValidDateString('2026-00-10'), false)
  assert.equal(isValidDateString('2026-01-00'), false)
  assert.equal(isValidDateString('2026-01-32'), false)
})

test('実在する日付を受理する', () => {
  assert.equal(isValidDateString('2028-02-29'), true) // うるう年
  assert.equal(isValidDateString('2026-02-28'), true)
  assert.equal(isValidDateString('2026-01-01'), true)
  assert.equal(isValidDateString('2026-12-31'), true)
  assert.equal(isValidDateString('2026-04-30'), true)
})

test('形式が違うものを拒否する', () => {
  assert.equal(isValidDateString(''), false)
  assert.equal(isValidDateString('2026-8-14'), false)
  assert.equal(isValidDateString('2026/08/14'), false)
  assert.equal(isValidDateString('20260814'), false)
  assert.equal(isValidDateString('2026-08-14T00:00:00Z'), false)
  assert.equal(isValidDateString(null), false)
  assert.equal(isValidDateString(undefined), false)
  assert.equal(isValidDateString(20260814), false)
})

test('西暦100年未満でも1900年代に丸めない', () => {
  assert.equal(isValidDateString('0099-02-29'), false)
  assert.equal(isValidDateString('0096-02-29'), true)
})
