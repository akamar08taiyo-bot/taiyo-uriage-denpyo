// html2canvas・jsPDF は最初から読み込む（前は押したときに別のファイル（assets/jspdf…・html2canvas…）を読み込んでいたが、それらの名前は公開し直すたびに変わり、
// 古いファイルは消すので、前の画面のまま開いていたタブでは「Failed to fetch dynamically imported module」で PDF保存・メールが動かなかった。2026-10-28）
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

function safeFileName(value) {
  return String(value || '売上伝票発行依頼書').replace(/[\\/:*?"<>|]/g, '_')
}

export function denpyoPdfName({ customerName, issueDate }) {
  return safeFileName(`${issueDate || ''}_${customerName || ''}_売上伝票発行依頼書.pdf`)
}

// 画面上は非表示（print:block）の帳票を、印刷と同じ見た目のままA4縦1枚のPDFにする（jsPDF を返す。保存・メールの添付で使う）。
export async function buildDenpyoPdf() {
  const source = document.querySelector('.uriage-print')
  if (!source) throw new Error('PDFにする帳票が見つかりませんでした。')

  if (document.fonts?.ready) await document.fonts.ready

  // 印刷用ブロックは通常時 display:none のため、画面外のサンドボックスで実寸表示させて描画する
  const sandbox = document.createElement('div')
  sandbox.className = 'pdf-export-sandbox'
  sandbox.setAttribute('aria-hidden', 'true')
  document.body.appendChild(sandbox)

  const page = source.cloneNode(true)
  page.classList.remove('hidden')
  page.classList.add('pdf-export-document')
  page.style.display = 'block'
  sandbox.appendChild(page)

  try {
    const canvas = await html2canvas(page, { backgroundColor: '#ffffff', logging: false, scale: 2, useCORS: true })
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 10
    const ratio = Math.min((pageWidth - margin * 2) / canvas.width, (pageHeight - margin * 2) / canvas.height)
    const imageWidth = canvas.width * ratio
    const imageHeight = canvas.height * ratio
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (pageWidth - imageWidth) / 2, margin, imageWidth, imageHeight, undefined, 'FAST')
    return pdf
  } finally {
    sandbox.remove()
  }
}

export async function downloadDenpyoPdf({ customerName, issueDate }) {
  const pdf = await buildDenpyoPdf()
  pdf.save(denpyoPdfName({ customerName, issueDate }))
}

/** メールの添付にする PDF（{name, type, bytes}） */
export async function denpyoPdfAttachment({ customerName, issueDate }) {
  const pdf = await buildDenpyoPdf()
  return { name: denpyoPdfName({ customerName, issueDate }), type: 'application/pdf', bytes: new Uint8Array(pdf.output('arraybuffer')) }
}
