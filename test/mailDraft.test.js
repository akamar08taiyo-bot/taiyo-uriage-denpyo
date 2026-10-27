// メールの下書き（.eml）：Outlook で開くと、件名・本文・添付の入った送信前のメールになる形か（ユーザーの依頼 2026-10-27）
import assert from 'node:assert/strict'
import test from 'node:test'
import { addressList, buildEml, encodeWord, isMobileDevice, safeFileName } from '../src/lib/mailDraft.js'

/** 見出しの =?UTF-8?B?…?= を戻す */
const decodeWords = (s) => s.replace(/\r\n /g, '').replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0))))
const decodeB64 = (s) => Uint8Array.from(atob(s.replace(/\r\n/g, '')), (c) => c.charCodeAt(0))

test('下書きのメール：宛先・件名・X-Unsent・本文・添付（PDF）', () => {
  const pdf = new TextEncoder().encode('%PDF-1.3 見本')
  const eml = buildEml({
    to: ['jimu@example.co.jp'],
    cc: ['kanri@example.co.jp'],
    subject: '売上伝票発行のご依頼 見本 花子様（とても長い件名になっても折り返して入る）',
    body: 'お疲れ様です。\n添付の通り、売上伝票の発行をお願いいたします。',
    attachments: [{ name: '2026-10-30_見本 花子_売上伝票発行依頼書.pdf', type: 'application/pdf', bytes: pdf }],
    boundary: 'BOUNDARY',
  })
  const [head, ...rest] = eml.split('\r\n\r\n')
  assert.match(head, /^To: jimu@example\.co\.jp\r\nCc: kanri@example\.co\.jp\r\nSubject: /)
  assert.match(head, /\r\nX-Unsent: 1\r\n/)
  assert.match(head, /Content-Type: multipart\/mixed; boundary="BOUNDARY"/)
  assert.equal(decodeWords(/Subject: ([\s\S]*?)\r\nX-Unsent/.exec(head)[1]), '売上伝票発行のご依頼 見本 花子様（とても長い件名になっても折り返して入る）')
  // 見出しの1行は 78字以内（長い件名は折り返す）
  for (const line of head.split('\r\n')) assert.ok(line.length <= 78, line)
  const body = rest.join('\r\n\r\n')
  const parts = body.split('--BOUNDARY').slice(1, -1).map((p) => p.replace(/^\r\n/, '').replace(/\r\n$/, ''))
  assert.equal(parts.length, 2)
  const [textHead, textBody] = parts[0].split('\r\n\r\n')
  assert.match(textHead, /text\/plain; charset="UTF-8"/)
  assert.equal(new TextDecoder().decode(decodeB64(textBody)), 'お疲れ様です。\r\n添付の通り、売上伝票の発行をお願いいたします。')
  const [fileHead, fileBody] = parts[1].split('\r\n\r\n')
  assert.match(fileHead, /^Content-Type: application\/pdf; name="=\?UTF-8\?B\?/)
  assert.equal(decodeWords(/filename="([^"]*)"/.exec(fileHead)[1]), '2026-10-30_見本 花子_売上伝票発行依頼書.pdf')
  assert.deepEqual(decodeB64(fileBody), pdf)
  assert.ok(eml.endsWith('--BOUNDARY--\r\n'))
})

test('宛先がなければ To・Cc の行を書かない（Outlook で入れる）', () => {
  const eml = buildEml({ subject: 'a', body: 'b', attachments: [], boundary: 'B' })
  assert.match(eml, /^Subject: a\r\n/)
  assert.ok(!/^To:/m.test(eml) && !/^Cc:/m.test(eml))
})

test('宛先の読み方・件名の英数字はそのまま・ファイル名・スマホの見分け', () => {
  assert.deepEqual(addressList('a@example.jp, b@example.jp；c@example.jp\nまちがい'), ['a@example.jp', 'b@example.jp', 'c@example.jp'])
  assert.deepEqual(addressList(''), [])
  assert.equal(encodeWord('Order 123'), 'Order 123')
  assert.equal(safeFileName('a/b:c', 'x'), 'a_b_c')
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), true)
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), true) // iPad
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 }), false)
})
