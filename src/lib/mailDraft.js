// ワンタッチのメール（ユーザーの依頼「作成したら、メールでそのまま、PDFかもしくは、Excelの資料送れる機能…添付とメールの文面の作成をワンタッチで」2026-10-27）。
// パソコンは、添付にする PDF・Excel を保存して、メールのソフト（Thunderbird など、mailto: を開く既定のアプリ）で宛先・件名・本文の入った新しいメールを開く。
// 保存したファイルは、ブラウザのダウンロードの一覧からメールにドラッグして付ける（mailto: ではファイルを付けられない）。
// 前は添付まで入った下書きのメール（.eml・X-Unsent: 1）を保存していたが、Edge（Chromium）は .eml を「デバイスに問題を起こす可能性がある」種類として止め
// （保存・保持を押さないと残らない）、メールにそのまま飛ばなかった（ユーザーの報告 2026-10-28。販売受注簿・売上伝票発行依頼書の両方）。
// スマホ・タブレット（ユーザーの話「タブレットからもおくります」）は共有メニュー（navigator.share）で、メールのアプリにファイルと本文を渡す（添付も入る）。
// 販売受注簿作成ツール（taiyo-hacchu-scan の src/lib/mailDraft.mjs）と同じ作り（写し）。

/**
 * メールのソフトに渡せる mailto: の長さ。Chromium（Edge・Chrome）は Windows でほかのアプリに渡す URL を 2048 字までにしていて、
 * それより長いと何も開かない（platform_util_win.cc の kMaxUrlLength。前後に " が付く）。日本語は1字が %XX×3 の9字になる
 */
export const MAILTO_MAX = 2000

/** 宛先（カンマ・空白・改行・；区切り）→ アドレスの並び。メールアドレスの形のものだけ */
export function addressList(value) {
  return String(value || '')
    .split(/[\s,;、，；]+/)
    .map((x) => x.trim())
    .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
}

/** mailto: の URL（宛先・CC・件名・本文。本文の改行は %0D%0A） */
export function buildMailto({ to = [], cc = [], subject = '', body = '' }) {
  const query = [
    ...(cc.length ? [`cc=${cc.map(encodeURIComponent).join(',')}`] : []),
    `subject=${encodeURIComponent(subject)}`,
    `body=${encodeURIComponent(String(body).replace(/\r?\n/g, '\r\n'))}`,
  ]
  return `mailto:${to.map(encodeURIComponent).join(',')}?${query.join('&')}`
}

/** メールのソフトに渡せる長さに収まるか（長い本文は呼ぶ側で行を減らす） */
export function mailtoFits(mail) {
  return buildMailto(mail).length <= MAILTO_MAX
}

/**
 * スマホ・タブレット（共有メニューでメールのアプリに渡せる端末）か。iPad はパソコンの Mac と同じ名前（Macintosh）で、Android のタブレットは
 * 「PC版サイト」の表示（大きな画面では初めからこれ）だと Linux のパソコンの名前で来るので、指で触れる画面かどうかでも見分ける。
 * Windows のパソコンは共有メニューに Thunderbird が出ないので、指で触れる画面でもパソコンと同じ（保存＋メールのソフト）
 */
export function isMobileDevice(nav = typeof navigator === 'undefined' ? null : navigator) {
  if (!nav) return false
  const ua = nav.userAgent || ''
  const touch = (nav.maxTouchPoints || 0) > 1
  return /iPhone|iPad|iPod|Android/i.test(ua) || nav.userAgentData?.platform === 'Android' || (/Macintosh|X11; Linux/.test(ua) && touch)
}

/**
 * 共有メニューを開けなかったとき（ファイルを作っているあいだに、押した操作の続きと見なされなくなった。iPad の Safari などは数秒で切れる）、
 * 画面の下に「メールのアプリに渡す」を出して、もう一度押してもらう（押したその場で共有メニューを開く）。戻り値：'shared'・'cancelled'・'failed'
 */
function shareOnTap(data) {
  return new Promise((resolve) => {
    const box = document.createElement('div')
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-label', 'メールのアプリに渡す')
    Object.assign(box.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: '2147483647', display: 'flex', gap: '8px',
      padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '12px', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
    })
    const button = (text, main) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = text
      // 字は 16px（iPhone・iPad で押すと画面が拡大しないように）・色は控えめに
      Object.assign(b.style, {
        fontSize: '16px', minHeight: '44px', padding: '0 18px', borderRadius: '8px', cursor: 'pointer',
        border: `1px solid ${main ? '#7dd3fc' : '#cbd5e1'}`, background: main ? '#f0f9ff' : '#ffffff', color: main ? '#075985' : '#334155',
      })
      return b
    }
    const go = button('📤 メールのアプリに渡す', true)
    const no = button('やめる', false)
    const done = (how) => {
      box.remove()
      resolve(how)
    }
    go.addEventListener('click', () => {
      navigator.share(data).then(() => done('shared'), (e) => done(e && e.name === 'AbortError' ? 'cancelled' : 'failed'))
    })
    no.addEventListener('click', () => done('cancelled'))
    box.append(go, no)
    document.body.appendChild(box)
    go.focus()
  })
}

/** ファイル名に使えない文字を除く */
export function safeFileName(value, fallback) {
  return String(value || fallback).replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || fallback
}

/** リンクを押したのと同じにする（ファイルの保存・mailto:） */
function follow(href, download) {
  const a = document.createElement('a')
  a.href = href
  if (download) a.download = download
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * ワンタッチのメール：スマホ・タブレットは共有メニュー、パソコンは添付のファイルを保存してメールのソフトで新しいメールを開く。
 * 押した操作の続きで呼ぶ（メールのソフトを開くのをブラウザに止められないように）。
 * 戻り値：'shared'（共有メニュー）・'mailto'（保存してメールのソフトを開いた）・'cancelled'（共有をやめた）
 */
export async function sendMailDraft({ to = [], cc = [], subject, body, attachment }) {
  const file = typeof File === 'function' ? new File([attachment.bytes], attachment.name, { type: attachment.type }) : null
  if (file && isMobileDevice() && navigator.canShare?.({ files: [file] })) {
    const data = { files: [file], title: subject, text: body }
    try {
      await navigator.share(data)
      return 'shared'
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled'
      if (e && e.name === 'NotAllowedError') {
        const how = await shareOnTap(data)
        if (how !== 'failed') return how
      }
      // 共有できなければ、パソコンと同じく保存してメールのソフトを開く
    }
  }
  const url = URL.createObjectURL(new Blob([attachment.bytes], { type: attachment.type }))
  follow(url, safeFileName(attachment.name, '添付'))
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  follow(buildMailto({ to, cc, subject, body }))
  return 'mailto'
}
