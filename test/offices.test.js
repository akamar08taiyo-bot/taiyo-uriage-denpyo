import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OFFICE_NAMES, officeChoices } from '../src/lib/offices.js'

test('全19営業所を含め、既存の独自候補と保存済みの営業所を重複させず残す', () => {
  const choices = officeChoices([' 行橋営業所 ', '本社'], '旧営業所')
  assert.equal(OFFICE_NAMES.length, 19)
  assert.equal(choices.length, 21)
  assert.ok(choices.includes('大分営業所'))
  assert.ok(choices.includes('本社'))
  assert.ok(choices.includes('旧営業所'))
  assert.equal(choices.filter(name => name === '行橋営業所').length, 1)
})
