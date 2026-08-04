function safeFileName(value) {
  return String(value || '売上伝票発行依頼書').replace(/[\\/:*?"<>|]/g, '_')
}

// 画面上は非表示（print:block）の帳票を、印刷と同じ見た目のままA4縦1枚のPDFにする。
export async function downloadDenpyoPdf({ customerName, issueDate }) {
  const source = document.querySelector('.uriage-print')
  if (!source) throw new Error('PDFにする帳票が見つかりませんでした。')

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
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
    pdf.save(safeFileName(`${issueDate || ''}_${customerName || ''}_売上伝票発行依頼書.pdf`))
  } finally {
    sandbox.remove()
  }
}
