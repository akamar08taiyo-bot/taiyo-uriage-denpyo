// ワンタッチのメール（販売受注簿作成ツールの test/mailDraft.test.mjs と同じ）：パソコンはメールのソフトを mailto: で開く。
// 前の .eml は Edge が「デバイスに問題を起こす可能性があります」と止め、メールにそのまま飛ばなかった（ユーザーの報告 2026-10-28）
import assert from 'node:assert/strict'
import test from 'node:test'
import { MAILTO_MAX, addressList, buildMailto, isMobileDevice, mailtoFits, safeFileName } from '../src/lib/mailDraft.js'

/** mailto: を読み戻す（宛先・cc・件名・本文） */
function readMailto(url) {
  const [head, query] = url.replace(/^mailto:/, '').split('?')
  const params = Object.fromEntries(query.split('&').map((kv) => kv.split('=')).map(([k, v]) => [k, decodeURIComponent(v)]))
  return { to: head ? head.split(',').map(decodeURIComponent) : [], ...params }
}

test('mailto：宛先・CC・件名・本文（改行は CRLF）が入る', () => {
  const url = buildMailto({
    to: ['jimu@example.co.jp', 'b@example.jp'],
    cc: ['kanri@example.co.jp'],
    subject: '発注依頼（販売受注簿送付）の件 見本 花子様',
    body: 'お疲れ様です。\n表題の通り、発注をお願いします。\n&=?#% の記号もそのまま',
  })
  assert.match(url, /^mailto:jimu%40example\.co\.jp,b%40example\.jp\?cc=/)
  assert.ok(!/[\s\u3000]/.test(url), '空白・日本語はすべて %XX にする')
  const m = readMailto(url)
  assert.deepEqual(m.to, ['jimu@example.co.jp', 'b@example.jp'])
  assert.equal(m.cc, 'kanri@example.co.jp')
  assert.equal(m.subject, '発注依頼（販売受注簿送付）の件 見本 花子様')
  assert.equal(m.body, 'お疲れ様です。\r\n表題の通り、発注をお願いします。\r\n&=?#% の記号もそのまま')
})

test('宛先がなければ mailto:? で始める（メールのソフトで入れる）', () => {
  assert.match(buildMailto({ subject: 'a', body: 'b' }), /^mailto:\?subject=a&body=b$/)
})

test('長さ：Edge・Chrome が Windows でほかのアプリに渡せる 2048 字より短く収める', () => {
  assert.ok(MAILTO_MAX <= 2046)
  const line = '・入浴グリップ 見本 PN-0000 オレンジ（PN-0000）　1台'
  assert.equal(mailtoFits({ subject: '件名', body: Array(3).fill(line).join('\n') }), true)
  assert.equal(mailtoFits({ subject: '件名', body: Array(12).fill(line).join('\n') }), false)
})

test('宛先の読み方・ファイル名・スマホの見分け', () => {
  assert.deepEqual(addressList('a@example.jp, b@example.jp；c@example.jp\nまちがい'), ['a@example.jp', 'b@example.jp', 'c@example.jp'])
  assert.deepEqual(addressList(''), [])
  assert.equal(safeFileName('a/b:c', 'x'), 'a_b_c')
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), true)
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), true) // iPad
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 }), false)
  // Android のタブレット：「PC版サイト」の表示では Linux のパソコンの名前で来る（指で触れる画面で見分ける）
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X710)' }), true)
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36', maxTouchPoints: 10 }), true)
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0, userAgentData: { platform: 'Android' } }), true)
  // Windows のパソコンは指で触れる画面でもパソコンと同じ（共有メニューに Thunderbird が出ないので）
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 10 }), false)
})
