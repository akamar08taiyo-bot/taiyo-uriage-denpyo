// メールの下書き（ユーザーの依頼「作成したら、メールでそのまま、PDFかもしくは、Excelの資料送れる機能…添付とメールの文面の作成をワンタッチで」2026-10-27）。
// 会社のパソコンは Outlook（パソコンのソフト）なので、添付ファイル付きの下書きのメールファイル（.eml。X-Unsent: 1）を作って保存する。
// 開くと Outlook で、件名・本文・添付の入った新しいメール（送信前）になる。宛先は設定に入れてあれば入る（なければ Outlook で入れる）。
// スマホ・iPad は共有メニュー（navigator.share）で、メールのアプリにファイルと本文を渡す。
// mailto: ではファイルを付けられないため。販売受注簿作成ツール（taiyo-hacchu-scan の src/lib/mailDraft.mjs）も同じ作り。

const CRLF = '\r\n'

/** UTF-8 のバイト列 → base64（76字ごとに改行） */
export function base64Lines(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const b64 = btoa(bin)
  return b64.match(/.{1,76}/g)?.join(CRLF) ?? ''
}

const utf8 = (text) => new TextEncoder().encode(text)

/** 見出しの日本語（RFC 2047。長い件名は 1つ 39バイトまでで分けて、1行 78字以内に折り返す） */
export function encodeWord(text) {
  if (/^[\x20-\x7e]*$/.test(text)) return text
  const words = []
  let chunk = ''
  for (const ch of text) {
    if (utf8(chunk + ch).length > 39) {
      words.push(chunk)
      chunk = ''
    }
    chunk += ch
  }
  if (chunk) words.push(chunk)
  return words.map((w) => `=?UTF-8?B?${btoa(String.fromCharCode(...utf8(w)))}?=`).join(`${CRLF} `)
}

/** 添付のファイル名：1つの =?UTF-8?B?…?=（Outlook はかっこの中のこの形を読む。分けない） */
function encodeName(name) {
  return /^[\x20-\x7e]*$/.test(name) ? name : `=?UTF-8?B?${btoa(String.fromCharCode(...utf8(name)))}?=`
}

/** 宛先（カンマ・空白・改行・；区切り）→ アドレスの並び。メールアドレスの形のものだけ */
export function addressList(value) {
  return String(value || '')
    .split(/[\s,;、，；]+/)
    .map((x) => x.trim())
    .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
}

/**
 * 下書きのメール（.eml）の中身。attachments は {name, type, bytes: Uint8Array}。
 * X-Unsent: 1 で、Outlook は開いたときに送信前の新しいメールとして出す
 */
export function buildEml({ to = [], cc = [], subject = '', body = '', attachments = [], boundary = `----=_taiyo_${Date.now().toString(36)}` }) {
  const head = [
    ...(to.length ? [`To: ${to.join(', ')}`] : []),
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${encodeWord(subject)}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ]
  const parts = [
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(utf8(body.replace(/\r?\n/g, CRLF))),
    ].join(CRLF),
    ...attachments.map((a) =>
      [
        `--${boundary}`,
        `Content-Type: ${a.type}; name="${encodeName(a.name)}"`,
        `Content-Disposition: attachment; filename="${encodeName(a.name)}"`,
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(a.bytes),
      ].join(CRLF),
    ),
  ]
  return `${head.join(CRLF)}${CRLF}${CRLF}${parts.join(CRLF)}${CRLF}--${boundary}--${CRLF}`
}

/** スマホ・タブレット（共有メニューでメールのアプリに渡せる端末）か */
export function isMobileDevice(nav = typeof navigator === 'undefined' ? null : navigator) {
  if (!nav) return false
  const ua = nav.userAgent || ''
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1)
}

/** ファイル名に使えない文字を除く */
export function safeFileName(value, fallback) {
  return String(value || fallback).replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || fallback
}

/**
 * ワンタッチのメール：スマホ・iPad は共有メニュー、パソコンは Outlook で開く下書き（.eml）を保存する。
 * 戻り値：'shared'（共有メニュー）・'eml'（下書きを保存）・'cancelled'（共有をやめた）
 */
export async function sendMailDraft({ to = [], cc = [], subject, body, attachment }) {
  const file = typeof File === 'function' ? new File([attachment.bytes], attachment.name, { type: attachment.type }) : null
  if (file && isMobileDevice() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: subject, text: body })
      return 'shared'
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled'
      // 共有できなければ下書きのファイルにする
    }
  }
  const eml = buildEml({ to, cc, subject, body, attachments: [attachment] })
  const url = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFileName(subject, 'メール')}.eml`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'eml'
}
