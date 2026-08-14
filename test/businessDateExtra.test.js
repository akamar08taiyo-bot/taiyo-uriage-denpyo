// formatDateInTokyo の追加テスト（共通モジュールの一部）
import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDateInTokyo } from '../src/lib/businessDate.js'

test('formatDateInTokyo は任意のDateを日本時間で解釈する', () => {
  // UTC深夜0時 → 日本時間では同日9時
  assert.equal(formatDateInTokyo(new Date('2026-08-14T00:00:00Z')), '2026-08-14')
  // UTC 15:00 → 日本時間では翌日0時
  assert.equal(formatDateInTokyo(new Date('2026-08-13T15:00:00Z')), '2026-08-14')
  // UTC 14:59 → 日本時間ではまだ当日23:59
  assert.equal(formatDateInTokyo(new Date('2026-08-13T14:59:00Z')), '2026-08-13')
})

test('formatDateInTokyo は無効な入力に null を返す', () => {
  assert.equal(formatDateInTokyo(new Date('壊れた日付')), null)
  assert.equal(formatDateInTokyo(null), null)
  assert.equal(formatDateInTokyo('2026-08-14'), null)
  assert.equal(formatDateInTokyo(undefined), null)
})
