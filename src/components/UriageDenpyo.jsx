import { useState, useEffect, useMemo } from 'react'
import { printDoc } from '../print.js'
import { encodePayload, decodePayload, shortenUrl, readPayloadFromHash, writeClipboard } from '../share.js'

/* ── 定数 ─────────────────────────────────── */
const DEFAULT_REMAINING = { housing: 200000, specific: 100000 }
const CARE_LEVELS = ['支援１', '支援２', '介護１', '介護２', '介護３', '介護４', '介護５']
const CATALOGS = ['ケアマックス', 'ウェルファン']
const TAX = 1.1
// 特定福祉用具の種目（複数選択可）
const SPECIFIC_CATEGORIES = [
  'シャワーチェア',
  '浴槽手すり',
  '浴槽台',
  '腰掛便座',
  'スロープ',
  '歩行器',
  '歩行補助杖',
  '移動用リフトのつり具',
  '自動排泄処理装置の交換可能備品',
  '排泄予測支援機器',
  '簡易浴槽',
]

// 業務アプリポータル(taiyo-portal)でログイン時に選んだ営業所名を引き継ぐ。
// この端末で既に営業所名を入力済みの場合は、そちらを優先する（上書きしない）。
const portalSessionOffice = () => {
  try {
    const raw = localStorage.getItem('taiyo_portal_session')
    const s = raw ? JSON.parse(raw) : null
    return s && s.office ? s.office : ''
  } catch {
    return ''
  }
}

let _seq = 0
const newItem = () => ({ id: ++_seq, amount: 0, cost: 0, catalog: 'ケアマックス', productName: '', color: '' })
const fmt = (n) => `¥${Math.round(n || 0).toLocaleString()}`
// 税抜は切り上げ（例: 39,680 → 36,073、80,900 → 73,546）
const exTax = (n) => Math.ceil((n || 0) / TAX)

/* ── 計算ロジック ────────────────────────────── */
function calculate({ items, total, remaining, userRatio, miyako, isSelfPay }) {
  const insuranceRatio = 1 - userRatio
  // 介護保険残高が未入力（空欄）のときは支給限度額の超過なしとして計算する。
  // 超過しそうな場合だけ残高を入力してもらう運用に合わせている。
  const hasRemaining = remaining !== '' && remaining !== null && remaining !== undefined
  const effRemaining = isSelfPay ? 0 : (hasRemaining ? Number(remaining) || 0 : total)
  const insuranceCovered = Math.min(total, effRemaining)
  const excess = Math.max(0, total - effRemaining)
  let userBurden, insurerBurden
  if (miyako) {
    userBurden = items.reduce((s, it) => s + Math.ceil(it.amount * userRatio), 0)
    insurerBurden = Math.max(0, insuranceCovered - userBurden)
  } else {
    userBurden = Math.ceil(insuranceCovered * userRatio)
    insurerBurden = Math.floor(insuranceCovered * insuranceRatio)
  }
  return { total, insuranceCovered, excess, userBurden, insurerBurden, totalUserBurden: userBurden + excess }
}

/* ── 印刷用の配色（白黒印刷でも判別できる濃さにしている） ── */
const PRINT_HEAD_BG = '#dbeafe'    // 表の見出し行
const PRINT_LABEL_BG = '#eff6ff'   // 項目名セル
const PRINT_EXTAX_BG = '#fef9c3'   // 税抜の列
const PRINT_MARK_BG = '#fff3a8'    // 利用者/保険者負担額の強調
const PRINT_TOTAL_BG = '#bfdbfe'   // ご利用者お支払い合計

/* ── スタイル定数 ─────────────────────────────── */
const card = 'bg-white/95 rounded-2xl shadow-sm ring-1 ring-sky-100/90 p-4 border border-white/80'
const sectionTitle = 'text-[11px] font-extrabold text-sky-800 tracking-[0.08em] mb-3'
const fieldLabel = 'block text-[11px] font-bold text-slate-600 mb-1'
const baseInput = 'w-full h-8 rounded-xl border border-slate-200 bg-slate-50/80 px-2 text-sm font-semibold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition'
const noSpin = '[-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0'

/* ── 小コンポーネント ─────────────────────────── */
function OptionRow({ label, options, value, onChange, cols }) {
  return (
    <div>
      <span className={fieldLabel}>{label}</span>
      <div className={`grid gap-1 ${cols || `grid-cols-${options.length}`}`}>
        {options.map((o) => {
          const v = typeof o === 'object' ? o.value : o
          const lbl = typeof o === 'object' ? o.label : o
          const active = value === v
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={`h-7 rounded-md text-xs font-medium transition ${
                active
                  ? 'bg-sky-600 text-white shadow-sm shadow-sky-200'
                  : 'bg-slate-100/80 text-slate-600 hover:bg-sky-50 hover:text-sky-800'
              }`}
            >
              {lbl}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MoneyInput({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">¥</span>
      <input
        type="number"
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        placeholder={placeholder || '0'}
        className={`${baseInput} ${noSpin} pl-6 text-right`}
      />
    </div>
  )
}

/* ── メインコンポーネント ─────────────────────── */
const normalizeMasterLines = (value) => [
  ...new Set(
    String(value || '')
      .split(/\r?\n|、|,/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
]

const createMasterDraft = (master) => ({
  offices: (master?.offices || []).join('\n'),
  salesPersons: (master?.salesPersons || []).join('\n'),
  contractors: (master?.contractors || []).join('\n'),
})

function MasterSettingsPanel({ draft, onChange, onCancel, onSave }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="master-settings-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <form
        className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-3xl border border-sky-100 bg-white shadow-2xl shadow-sky-950/15"
        onSubmit={(event) => {
          event.preventDefault()
          onSave()
        }}
      >
        <div className="border-b border-sky-100 bg-sky-50 px-5 py-4">
          <h2 id="master-settings-title" className="text-lg font-black text-slate-800">マスタ設定</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            営業所・担当者・工務店の候補を1行ずつ登録できます。伝票に入力した内容は自動で記憶され、次回はそのまま引き継がれます。
          </p>
        </div>
        <div className="grid gap-5 p-5 md:grid-cols-3">
          <section>
            <label className={fieldLabel} htmlFor="master-offices">営業所の候補</label>
            <textarea
              id="master-offices"
              rows={8}
              value={draft.offices}
              onChange={(event) => onChange({ ...draft, offices: event.target.value })}
              className={`${baseInput} h-auto min-h-40 resize-y py-2 leading-6`}
              placeholder={'本社\n福岡営業所'}
            />
          </section>
          <section>
            <label className={fieldLabel} htmlFor="master-staff">担当者の候補</label>
            <textarea
              id="master-staff"
              rows={8}
              value={draft.salesPersons}
              onChange={(event) => onChange({ ...draft, salesPersons: event.target.value })}
              className={`${baseInput} h-auto min-h-40 resize-y py-2 leading-6`}
              placeholder={'山田 太郎\n佐藤 花子'}
            />
          </section>
          <section>
            <label className={fieldLabel} htmlFor="master-contractors">工務店の候補</label>
            <textarea
              id="master-contractors"
              rows={8}
              value={draft.contractors}
              onChange={(event) => onChange({ ...draft, contractors: event.target.value })}
              className={`${baseInput} h-auto min-h-40 resize-y py-2 leading-6`}
              placeholder={'○○工務店\n△△建設'}
            />
          </section>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-5 py-4">
          <p className="text-xs font-semibold text-slate-500">手入力した内容も自動保存され、次回の起動時に復元されます。</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-xs font-extrabold text-slate-600 hover:bg-slate-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="h-10 rounded-xl bg-sky-600 px-5 text-xs font-extrabold text-white shadow-sm shadow-sky-200 hover:brightness-[.98]"
            >
              保存して反映
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

export default function UriageDenpyo({
  master = { offices: [], salesPersons: [], contractors: [] },
  setMaster = null,
  bridge = null,
  setBridge = null,
}) {
  const staffList = master.salesPersons || []
  const officeList = master.offices || []
  const contractorList = master.contractors || []
  const [salesOffice, setSalesOffice] = useState(() => localStorage.getItem('fukushi_salesOffice') || portalSessionOffice() || '')
  const today = new Date().toISOString().slice(0, 10)

  /* state */
  const [serviceType, setServiceType] = useState('housing')
  const [issueDate, setIssueDate] = useState(today)
  // 基本情報（顧客名/住所/居宅名/担当ケアマネ）は bridge を唯一の真値源にする。
  // ループ防止のため UriageDenpyo の useState は持たず、直接 bridge を読み書きする。
  const customerName = bridge?.customerName ?? ''
  const customerAddress = bridge?.customerAddress ?? ''
  const officeName = bridge?.officeName ?? ''
  const careManager = bridge?.careManager ?? ''
  const setCustomerName = (v) => setBridge?.((prev) => prev ? { ...prev, customerName: v } : prev)
  const setCustomerAddress = (v) => setBridge?.((prev) => prev ? { ...prev, customerAddress: v } : prev)
  const setOfficeName = (v) => setBridge?.((prev) => prev ? { ...prev, officeName: v } : prev)
  const setCareManager = (v) => setBridge?.((prev) => prev ? { ...prev, careManager: v } : prev)
  const [customerType, setCustomerType] = useState('new')
  const [billingType, setBillingType] = useState('receipt')
  const [careLevel, setCareLevel] = useState('支援１')
  const [userRatio, setUserRatio] = useState(0.1)
  const [remaining, setRemaining] = useState('')
  const [showBalance, setShowBalance] = useState(false)
  const [items, setItems] = useState([newItem()])
  const [miyakoChecked, setMiyakoChecked] = useState(false)
  const [showExTax, setShowExTax] = useState(true)
  const [staff, setStaff] = useState(() => localStorage.getItem('fukushi_staff') || '')
  const [triedPrint, setTriedPrint] = useState(false)
  const [isSelfPay, setIsSelfPay] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [contractor, setContractor] = useState(() => localStorage.getItem('fukushi_contractor') || '')
  const [contractorManual, setContractorManual] = useState(false)
  const [categories, setCategories] = useState([])
  const toggleCategory = (c) =>
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  const [shareUrl, setShareUrl] = useState('')
  const [shareMsg, setShareMsg] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [showMasterSettings, setShowMasterSettings] = useState(false)
  const [masterDraft, setMasterDraft] = useState(() => createMasterDraft(master))

  /* localStorage 永続化：一度入力した営業所・担当者・工務店は次回起動時にそのまま復元する */
  useEffect(() => { localStorage.setItem('fukushi_staff', staff) }, [staff])
  useEffect(() => { localStorage.setItem('fukushi_salesOffice', salesOffice) }, [salesOffice])
  useEffect(() => { localStorage.setItem('fukushi_contractor', contractor) }, [contractor])
  // 未入力のときだけ、マスタ登録の先頭を補助的に採用する（既定値の設定項目は廃止）
  useEffect(() => {
    const valid = officeList.filter((n) => (n || '').trim())
    if (!salesOffice && valid[0]) setSalesOffice(valid[0])
  }, [officeList, salesOffice])

  /* サービス区分変更：明細(金額/仕切り)はクリア、基本情報・属性は維持 */
  useEffect(() => {
    setRemaining('')
    setMiyakoChecked(false)
    setItems([newItem()])
    if (serviceType !== 'specific') setCategories([])
  }, [serviceType])

  /* 受注簿「特例」セクション ⇄ 売上伝票 の双方向同期 */
  // bridge → 売上伝票（受信）
  useEffect(() => {
    if (!bridge || !bridge.enabled) return
    if (bridge.serviceType && bridge.serviceType !== serviceType) setServiceType(bridge.serviceType)
    if (Array.isArray(bridge.items)) {
      const fromBridge = JSON.stringify(
        bridge.items.map((b) => ({
          amount: Number(b.amount) || 0,
          cost: Number(b.cost) || 0,
          productName: b.productName || '',
          color: b.color || '',
        })),
      )
      const fromLocal = JSON.stringify(
        items.map((b) => ({
          amount: Number(b.amount) || 0,
          cost: Number(b.cost) || 0,
          productName: b.productName || '',
          color: b.color || '',
        })),
      )
      if (fromBridge !== fromLocal && bridge.items.length) {
        setItems(
          bridge.items.map((b, i) => ({
            id: b.id || Date.now() + i,
            amount: Number(b.amount) || 0,
            cost: Number(b.cost) || 0,
            productName: b.productName || '',
            modelNumber: '',
            colorSize: '',
            color: b.color || '',
            catalog: '',
          })),
        )
      }
    }
    if (bridge.customerType && bridge.customerType !== customerType) setCustomerType(bridge.customerType)
    if (bridge.billingType && bridge.billingType !== billingType) setBillingType(bridge.billingType)
    if (bridge.careLevel && bridge.careLevel !== careLevel) setCareLevel(bridge.careLevel)
    if (typeof bridge.userRatio === 'number' && bridge.userRatio !== userRatio) setUserRatio(bridge.userRatio)
    if (typeof bridge.isSelfPay === 'boolean' && bridge.isSelfPay !== isSelfPay) setIsSelfPay(bridge.isSelfPay)
    if (typeof bridge.remaining === 'number' && bridge.remaining !== remaining) setRemaining(bridge.remaining)
    if (typeof bridge.contractor === 'string' && bridge.contractor !== contractor) setContractor(bridge.contractor)
    if (Array.isArray(bridge.categories) && JSON.stringify(bridge.categories) !== JSON.stringify(categories)) {
      setCategories(bridge.categories)
    }
  }, [bridge])

  // 基本情報は bridge を直接読み書きするため、別途同期 useEffect は不要

  // 売上伝票 → bridge（送信）：常時。関数形 setBridge で安全に統合
  useEffect(() => {
    if (!setBridge) return
    const simpItems = items.map((it) => ({
      id: it.id,
      amount: Number(it.amount) || 0,
      cost: Number(it.cost) || 0,
      productName: it.productName || '',
      color: it.color || '',
    }))
    setBridge((prev) => {
      if (!prev) return prev
      const next = {
        serviceType,
        items: simpItems,
        customerType,
        billingType,
        careLevel,
        userRatio,
        isSelfPay,
        remaining,
        contractor,
        categories,
      }
      let diff = false
      for (const k of Object.keys(next)) {
        if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
          diff = true
          break
        }
      }
      return diff ? { ...prev, ...next } : prev
    })
  }, [serviceType, items, customerType, billingType, careLevel, userRatio, isSelfPay, remaining, contractor, categories])

  // 基本情報は input の onChange から直接 setBridge を呼ぶため、push useEffect は不要

  /* 共有リンクから状態復元 */
  useEffect(() => {
    const payload = decodePayload(readPayloadFromHash('uriage'))
    const s = payload?.sales
    if (!s) return
    if (s.serviceType) setServiceType(s.serviceType)
    if (s.issueDate) setIssueDate(s.issueDate)
    if (typeof s.salesOffice === 'string') setSalesOffice(s.salesOffice)
    if (typeof s.customerName === 'string') setCustomerName(s.customerName)
    if (typeof s.customerAddress === 'string') setCustomerAddress(s.customerAddress)
    if (typeof s.officeName === 'string') setOfficeName(s.officeName)
    if (typeof s.careManager === 'string') setCareManager(s.careManager)
    if (s.customerType) setCustomerType(s.customerType)
    if (s.billingType) setBillingType(s.billingType)
    if (s.careLevel) setCareLevel(s.careLevel)
    if (typeof s.userRatio === 'number') setUserRatio(s.userRatio)
    if (typeof s.remaining === 'number') setRemaining(s.remaining)
    if (Array.isArray(s.items) && s.items.length) {
      setItems(s.items.map((it) => ({ ...newItem(), ...it })))
    }
    if (typeof s.miyakoChecked === 'boolean') setMiyakoChecked(s.miyakoChecked)
    if (typeof s.showExTax === 'boolean') setShowExTax(s.showExTax)
    if (typeof s.staff === 'string') setStaff(s.staff)
    if (typeof s.isSelfPay === 'boolean') setIsSelfPay(s.isSelfPay)
    if (typeof s.showDetail === 'boolean') setShowDetail(s.showDetail)
    if (typeof s.contractor === 'string') setContractor(s.contractor)
    if (Array.isArray(s.categories)) setCategories(s.categories)
    else if (typeof s.category === 'string' && s.category) setCategories([s.category])
    setShareMsg('共有リンクから内容を読み込みました。')
    setShareUrl(location.href)
  }, [])

  /* 派生値 */
  const hasCost = serviceType === 'housing'
  const filledItems = items.filter((it) => it.amount > 0)
  const filledCount = filledItems.length
  const canMiyako = serviceType === 'specific' && filledCount >= 2
  const applyMiyako = canMiyako && miyakoChecked
  const total = items.reduce((s, it) => s + (it.amount || 0), 0)
  const totalCost = hasCost ? items.reduce((s, it) => s + (it.cost || 0), 0) : 0
  const profit = total - totalCost
  const profitRate = total > 0 ? ((profit / total) * 100).toFixed(1) : '0.0'
  // 印刷では入力された列だけを表示する
  const hasProductName = items.some((it) => (it.productName || '').trim())
  const hasColorInput = items.some((it) => (it.color || '').trim())
  const showPrintProductName = serviceType === 'specific' && hasProductName
  const showPrintColor = serviceType === 'specific' && hasColorInput

  const calc = useMemo(
    () => calculate({ items, total, remaining, userRatio, miyako: applyMiyako, isSelfPay }),
    [items, total, remaining, userRatio, applyMiyako, isSelfPay]
  )

  const burdenPct = Math.round(userRatio * 10)
  const insurancePct = 10 - burdenPct
  const burdenLabel = `${burdenPct}割`
  const insuranceLabel = `${insurancePct}割`

  /* 明細操作 */
  const updateItem = (id, field, value) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)))
  const removeItem = (id) => setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.id !== id)))
  const addItem = () => setItems((prev) => [...prev, newItem()])

  /* バリデーション */
  const errors = []
  if (!staff.trim()) errors.push('担当者')
  if (!customerName.trim()) errors.push('顧客名')
  const canPrint = errors.length === 0

  /* 印刷 */
  const handlePrint = () => {
    setTriedPrint(true)
    if (canPrint) printDoc('portrait')
  }

  /* PDF保存（印刷と同じ帳票レイアウトをそのままA4縦で出力する） */
  async function handleDownloadPdf() {
    setTriedPrint(true)
    if (!canPrint) return
    setPdfBusy(true)
    setShareMsg('')
    try {
      const { downloadDenpyoPdf } = await import('../pdf-export.js')
      await downloadDenpyoPdf({ customerName, issueDate })
      setShareMsg('PDFを保存しました。')
    } catch (error) {
      setShareMsg(error?.message || 'PDFを保存できませんでした。')
    } finally {
      setPdfBusy(false)
    }
  }

  /* 共有リンク・メール・全削除 */
  function snapshotSales() {
    return {
      serviceType, issueDate, salesOffice, customerName, customerAddress, officeName, careManager,
      customerType, billingType, careLevel, userRatio, remaining,
      items, miyakoChecked, showExTax, staff, isSelfPay, showDetail, contractor, categories,
      total, totalUserBurden: calc.totalUserBurden,
    }
  }
  function buildLongShareUrl() {
    const payload = encodePayload({ kind: 'uriage', sales: snapshotSales() })
    return `${location.origin}${location.pathname}#/uriage?payload=${payload}`
  }
  async function copyShareLink() {
    const longUrl = buildLongShareUrl()
    setShareUrl(longUrl)
    const copied = await writeClipboard(longUrl)
    setShareMsg(copied ? '共有URLをクリップボードにコピーしました。' : '共有URLを下に表示しました。')
  }
  function createMail() {
    // メール用は短縮しない長いURLをそのまま使用
    const longUrl = buildLongShareUrl()
    setShareUrl(longUrl)
    const subject = `売上伝票発行のご依頼 ${customerName || ''}`.trim()
    const body = `お疲れ様です。\n下記URLの通り、売上伝票の発行をお願いいたします。\n\n${longUrl}\n`
    location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  function openMasterSettings() {
    setMasterDraft(createMasterDraft(master))
    setShowMasterSettings(true)
  }

  function saveMasterSettings() {
    setMaster?.((previous) => ({
      ...previous,
      offices: normalizeMasterLines(masterDraft.offices),
      salesPersons: normalizeMasterLines(masterDraft.salesPersons),
      contractors: normalizeMasterLines(masterDraft.contractors),
    }))
    setShowMasterSettings(false)
    setShareMsg('マスタ設定を保存しました。')
  }

  function clearAll() {
    if (!window.confirm('入力内容をすべて削除します。よろしいですか？')) return
    setServiceType('housing')
    setIssueDate(today)
    setCustomerName('')
    setCustomerAddress('')
    setOfficeName('')
    setCareManager('')
    setCustomerType('new')
    setBillingType('receipt')
    setCareLevel('支援１')
    setUserRatio(0.1)
    setRemaining('')
    setItems([newItem()])
    setMiyakoChecked(false)
    setShowExTax(false)
    setTriedPrint(false)
    setIsSelfPay(false)
    setShowDetail(false)
    setContractor('')
    setContractorManual(false)
    setCategories([])
    setShareUrl('')
    // 営業所はマスタ固定のため空白化しない
    setShareMsg('入力内容を削除しました。')
  }

  /* 計算結果行 */
  const resultRows = [
    ['総合計（税込）', calc.total],
    ...(hasCost ? [['仕切り合計（税込）', totalCost]] : []),
    ['保険対象金額', calc.insuranceCovered],
    ...(calc.excess > 0 ? [['超過分（実費）', calc.excess]] : []),
    [`対象内利用者負担額（${burdenLabel}・切り上げ）`, calc.userBurden],
    [`保険者負担額（${insuranceLabel}・切り下げ）`, calc.insurerBurden],
  ]

  const staffOptions = staffList.filter((n) => (n || '').trim())
  const contractorOptions = contractorList.filter((n) => (n || '').trim())

  /* ── 画面 ─────────────────────────────────── */
  return (
    <>
    {showMasterSettings && (
      <MasterSettingsPanel
        draft={masterDraft}
        onChange={setMasterDraft}
        onCancel={() => setShowMasterSettings(false)}
        onSave={saveMasterSettings}
      />
    )}
    <div className="uriage-app-shell print:hidden">
      {/* アクションバー */}
      <div className="max-w-[1500px] mx-auto px-4 pt-4">
        <div className="uriage-hero rounded-3xl px-5 py-4 mb-3 flex flex-wrap items-center gap-4">
          <div className="uriage-brand-mark h-12 w-12 rounded-2xl flex items-center justify-center text-white text-xl font-black">
            太
          </div>
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-sky-700 tracking-[0.16em]">太陽シルバーサービス</p>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-800">売上伝票発行依頼書（住宅改修・特定福祉用具購入）</h1>
          </div>
          <div className="ml-auto flex flex-wrap gap-2 text-[11px] font-bold text-slate-600">
            <span className="rounded-full bg-sky-50 border border-sky-100 px-3 py-1">URL共有対応</span>
            <span className="rounded-full bg-teal-50 border border-teal-100 px-3 py-1">印刷対応</span>
          </div>
        </div>
        {bridge && bridge.enabled && (
          <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
            販売受注簿の特例入力から自動転記されています（受注簿タブ側で編集できます）
          </div>
        )}
        <div className="bg-white/95 rounded-2xl shadow-sm ring-1 ring-sky-100/90 px-3 py-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-extrabold text-sky-800">操作:</span>
          <button type="button" onClick={createMail} className="h-9 px-3 rounded-xl text-xs font-extrabold bg-white border border-sky-200 text-sky-800 hover:bg-sky-50">メール作成</button>
          <button type="button" onClick={handleDownloadPdf} disabled={pdfBusy} className="h-9 px-3 rounded-xl text-xs font-extrabold bg-white border border-sky-200 text-sky-800 hover:bg-sky-50 disabled:opacity-60">{pdfBusy ? 'PDF作成中…' : 'PDF保存'}</button>
          <button type="button" onClick={copyShareLink} className="h-9 px-3 rounded-xl text-xs font-extrabold bg-sky-600 text-white shadow-sm shadow-sky-200 hover:brightness-[.98]">共有リンク</button>
          <button type="button" onClick={openMasterSettings} className="h-9 px-3 rounded-xl text-xs font-extrabold bg-white border border-sky-200 text-sky-800 hover:bg-sky-50">マスタ設定</button>
          <button type="button" onClick={clearAll} className="h-9 px-3 rounded-xl text-xs font-extrabold border border-rose-200 text-rose-600 hover:bg-rose-50">空白の状態に戻す</button>
          <div className="ml-auto text-xs font-bold text-slate-500">{shareMsg}</div>
        </div>
        {shareUrl && (
          <div className="mt-2 share-box">
            <span className="text-xs font-black text-teal-900">共有URL</span>
            <a className="truncate text-sm font-bold text-teal-950 underline" href={shareUrl}>{shareUrl}</a>
            <button
              className="toggle-button min-h-[36px] px-3 py-1"
              onClick={async () => {
                const ok = await writeClipboard(shareUrl)
                setShareMsg(ok ? '共有URLをコピーしました。' : '共有URLを表示しています。')
              }}
              type="button"
            >コピー</button>
          </div>
        )}
      </div>

      {/* メインコンテンツ */}
      <main className="max-w-[1500px] mx-auto px-4 py-3 grid gap-4 lg:grid-cols-2">
        {/* ── 左カラム ───────────────────────── */}
        <div className="space-y-3">
          {/* サービス区分 */}
          <div className={card}>
            <p className={sectionTitle}>サービス区分</p>
            <OptionRow
              label=""
              options={[
                { value: 'housing', label: '住宅改修' },
                { value: 'specific', label: '特定福祉用具' },
              ]}
              value={serviceType}
              onChange={setServiceType}
              cols="grid-cols-2"
            />
            {serviceType === 'specific' && (
              <div className="mt-3">
                <label className={fieldLabel}>種目（複数選択可）</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                  {SPECIFIC_CATEGORIES.map((c) => {
                    const active = categories.includes(c)
                    return (
                      <label
                        key={c}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs font-bold cursor-pointer transition ${
                          active
                          ? 'bg-sky-600 text-white border-sky-500 shadow-sm shadow-sky-200'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-sky-50 hover:border-sky-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => toggleCategory(c)}
                          className="w-3.5 h-3.5 accent-blue-600"
                        />
                        <span>{c}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 基本情報 */}
          <div className={card}>
            <p className={sectionTitle}>基本情報</p>
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <label className={fieldLabel}>施工（納品予定日）</label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className={baseInput}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>営業所</label>
                  <input
                    type="text"
                    list="uriage-office-list"
                    value={salesOffice}
                    onChange={(e) => setSalesOffice(e.target.value)}
                    className={baseInput}
                    placeholder="営業所を入力"
                  />
                  <datalist id="uriage-office-list">
                    {officeList.filter((n) => (n || '').trim()).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className={fieldLabel}>担当者 <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    list="uriage-staff-list"
                    value={staff}
                    onChange={(e) => setStaff(e.target.value)}
                    className={`${baseInput} ${triedPrint && !staff ? 'border-red-400 ring-2 ring-red-100' : ''}`}
                    placeholder="担当者名を入力"
                  />
                  <datalist id="uriage-staff-list">
                    {staffOptions.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </datalist>
                </div>
              </div>
              <div>
                <label className={fieldLabel}>
                  顧客名 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className={`${baseInput} ${triedPrint && !customerName.trim() ? 'border-red-400 ring-2 ring-red-100' : ''}`}
                  placeholder="例: 山田太郎"
                />
              </div>
              <div>
                <label className={fieldLabel}>住所</label>
                <input
                  type="text"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  className={baseInput}
                  placeholder="例: 福岡県行橋市..."
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={fieldLabel}>居宅名</label>
                  <input
                    type="text"
                    value={officeName}
                    onChange={(e) => setOfficeName(e.target.value)}
                    className={baseInput}
                    placeholder="居宅事業所名"
                  />
                </div>
                <div>
                  <label className={fieldLabel}>担当ケアマネージャー</label>
                  <input
                    type="text"
                    value={careManager}
                    onChange={(e) => setCareManager(e.target.value)}
                    className={baseInput}
                    placeholder="ケアマネ名"
                  />
                </div>
              </div>
              {/* 施工業者（住宅改修のみ） */}
              {serviceType === 'housing' && (
                <div>
                  <label className={fieldLabel}>施工業者</label>
                  <input
                    type="text"
                    list="uriage-contractor-list"
                    value={contractor}
                    onChange={(e) => setContractor(e.target.value)}
                    placeholder={contractorList.length ? '入力 / 候補から選択' : '施工業者名を入力'}
                    className={baseInput}
                  />
                  <datalist id="uriage-contractor-list">
                    {contractorList.filter((n) => (n || '').trim()).map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </div>
              )}
            </div>
          </div>

          {/* 属性 */}
          <div className={card}>
            <p className={sectionTitle}>属性</p>
            <div className="space-y-2">
              <OptionRow
                label="顧客区分"
                options={[
                  { value: 'new', label: '新規' },
                  { value: 'existing', label: '既存' },
                ]}
                value={customerType}
                onChange={setCustomerType}
                cols="grid-cols-2"
              />
              <OptionRow
                label="請求区分"
                options={[
                  { value: 'receipt', label: '受領委任払い' },
                  { value: 'reimbursement', label: '償還払い' },
                ]}
                value={billingType}
                onChange={setBillingType}
                cols="grid-cols-2"
              />
              <OptionRow
                label="介護度"
                options={CARE_LEVELS}
                value={careLevel}
                onChange={setCareLevel}
                cols="grid-cols-7"
              />
              <OptionRow
                label="負担割合"
                options={[
                  { value: 0.1, label: '1割' },
                  { value: 0.2, label: '2割' },
                  { value: 0.3, label: '3割' },
                ]}
                value={userRatio}
                onChange={setUserRatio}
                cols="grid-cols-3"
              />
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="selfpay"
                  checked={isSelfPay}
                  onChange={(e) => setIsSelfPay(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="selfpay" className="text-xs text-slate-600">全額自費</label>
              </div>
            </div>
          </div>

          {/* 介護保険残高（任意・超過しそうな時のみ） */}
          <div className="bg-white/95 rounded-2xl shadow-sm ring-1 ring-sky-100/90 border border-white/80 p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-extrabold text-slate-700">介護保険残高</p>
              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">任意</span>
            </div>
            <p className="text-[10px] text-slate-500 mb-2 leading-snug">
              ※ 支給限度額を<strong className="text-slate-700">超過しそうな場合のみ</strong>入力してください。通常は未入力でOK。
            </p>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-bold text-slate-500">¥</span>
              <input
                type="number"
                value={remaining || ''}
                onChange={(e) => setRemaining(e.target.value === '' ? '' : Number(e.target.value) || 0)}
                placeholder="超過しそうな時のみ入力"
                className="w-full h-11 rounded-2xl border border-slate-200 bg-slate-50/80 pl-8 pr-3 text-right text-xl font-extrabold tracking-tight text-slate-800 focus:bg-white focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
        </div>

        {/* ── 右カラム ───────────────────────── */}
        <div className="space-y-3">
          {/* 明細 */}
          <div className={card}>
            <div className="flex items-center justify-between mb-2">
              <p className={`${sectionTitle} mb-0`}>明細<span className="ml-1.5 font-bold text-[10px] text-sky-700">（税込金額で入力）</span></p>
              {serviceType === 'specific' && (
                <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDetail}
                    onChange={(e) => setShowDetail(e.target.checked)}
                    className="rounded"
                  />
                  商品名も表示
                </label>
              )}
            </div>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={item.id} className="space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400 w-5 text-right">{i + 1}</span>
                    {hasCost ? (
                      <div className="flex-1 grid grid-cols-2 gap-1">
                        <MoneyInput
                          value={item.amount}
                          onChange={(v) => updateItem(item.id, 'amount', v)}
                          placeholder="金額(税込)"
                        />
                        <MoneyInput
                          value={item.cost}
                          onChange={(v) => updateItem(item.id, 'cost', v)}
                          placeholder="仕切り(税込)"
                        />
                      </div>
                    ) : (
                      <div className="w-40">
                        <MoneyInput
                          value={item.amount}
                          onChange={(v) => updateItem(item.id, 'amount', v)}
                          placeholder="金額(税込)"
                        />
                      </div>
                    )}
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="h-8 w-8 rounded-lg text-xs text-red-400 hover:bg-red-50 transition flex-shrink-0"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {/* 商品詳細（特定福祉用具のみ）：カラーは常時表示、商品名はトグルON時のみ */}
                  {serviceType === 'specific' && (
                    <div className={`ml-6 grid gap-1 ${showDetail ? 'grid-cols-[3fr_1fr]' : 'grid-cols-1 max-w-[160px]'}`}>
                      {showDetail && (
                        <input
                          type="text"
                          value={item.productName}
                          onChange={(e) => updateItem(item.id, 'productName', e.target.value)}
                          placeholder="商品名"
                          className={`${baseInput} text-[11px] h-7`}
                        />
                      )}
                      <input
                        type="text"
                        value={item.color}
                        onChange={(e) => updateItem(item.id, 'color', e.target.value)}
                        placeholder="カラー"
                        className={`${baseInput} text-[11px] h-7`}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addItem}
              className="mt-2 text-xs font-extrabold text-sky-600 hover:text-sky-800"
            >
              ＋ 明細追加
            </button>

            {/* 個別切り上げチェック */}
            {canMiyako && (
              <div className="mt-2 flex items-center gap-2 p-2 bg-amber-50 rounded-lg">
                <input
                  type="checkbox"
                  id="miyako"
                  checked={miyakoChecked}
                  onChange={(e) => setMiyakoChecked(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="miyako" className="text-xs text-amber-700">
                  個別切り上げ（各明細ごとに利用者負担を切り上げ）
                </label>
              </div>
            )}
          </div>

          {/* 仕切り合計（住宅改修のみ） */}
          {hasCost && total > 0 && (
            <div className={card}>
              <p className={sectionTitle}>仕切り・利益</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-slate-400">仕切り合計</p>
                  <p className="text-sm font-semibold text-slate-700">{fmt(totalCost)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">利益金額</p>
                  <p className="text-sm font-semibold text-slate-700">{fmt(profit)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">利益率</p>
                  <p className="text-sm font-semibold text-slate-700">{profitRate}%</p>
                </div>
              </div>
            </div>
          )}

          {/* 計算結果 */}
          <div className={card}>
            <div className="flex items-center justify-between mb-2">
              <p className={`${sectionTitle} mb-0`}>計算結果</p>
              <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showExTax}
                  onChange={(e) => setShowExTax(e.target.checked)}
                  className="rounded"
                />
                税抜表示
              </label>
            </div>
            <table className="w-full text-sm">
              {showExTax && (
                <thead>
                  <tr className="text-[10px] text-slate-400">
                    <th className="text-left font-normal pb-1">項目</th>
                    <th className="text-right font-normal pb-1 w-24">税込</th>
                    <th className="text-right font-normal pb-1 w-24">税抜</th>
                  </tr>
                </thead>
              )}
              <tbody>
                {resultRows.map(([label, val]) => (
                  <tr key={label} className="border-t border-slate-100">
                    <td className="py-1 text-xs text-slate-600">{label}</td>
                    <td className="py-1 text-right font-medium text-slate-800 w-24">{fmt(val)}</td>
                    {showExTax && (
                      <td className="py-1 text-right text-slate-500 w-24">{fmt(exTax(val))}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 合計パネル */}
          <div className="bg-sky-600 text-white rounded-2xl p-4 shadow-md shadow-sky-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">ご利用者お支払い合計</span>
              <span className="text-xl font-bold">{fmt(calc.totalUserBurden)}</span>
            </div>
            {showExTax && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-blue-200">税抜</span>
                <span className="text-sm text-blue-100">{fmt(exTax(calc.totalUserBurden))}</span>
              </div>
            )}
          </div>

          {/* エラー表示 & 印刷ボタン */}
          {triedPrint && !canPrint && (
            <p className="text-xs text-red-500">未入力: {errors.join('、')}</p>
          )}
          <button
            type="button"
            onClick={handlePrint}
            className="w-full h-11 bg-sky-600 hover:brightness-[.98] text-white text-sm font-extrabold rounded-2xl shadow-md shadow-sky-200 transition"
          >
            印刷
          </button>
        </div>
      </main>
    </div>

    {/* ── 印刷シート（親の外） ──────────────────── */}
    <div className="uriage-print hidden print:block p-0 text-[13px] leading-[1.5]">
      {/* 印刷ヘッダー */}
      <div className="text-center mb-4">
        <p className="text-xs text-slate-500">{salesOffice}</p>
        <h1 className="text-base font-bold mt-1">売上伝票発行依頼書（住宅改修・特定福祉用具購入）</h1>
      </div>

      {/* 基本情報テーブル */}
      <table className="w-full table-fixed border-collapse border border-slate-500 mb-3">
        <colgroup>
          <col style={{ width: '18%' }} />
          <col style={{ width: '32%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '32%' }} />
        </colgroup>
        <tbody>
          <tr>
            <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>サービス区分</th>
            <td className="border border-slate-500 px-2 py-1">
              {serviceType === 'housing' ? '住宅改修' : '特定福祉用具'}
            </td>
            <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>施工（納品予定日）</th>
            <td className="border border-slate-500 px-2 py-1">{issueDate}</td>
          </tr>
          {serviceType === 'specific' && (
            <tr>
              <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>種目</th>
              <td className="border border-slate-500 px-2 py-1" colSpan={3}>{categories.join('、')}</td>
            </tr>
          )}
          <tr>
            <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>担当者</th>
            <td className="border border-slate-500 px-2 py-1">{staff}</td>
            <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>顧客区分</th>
            <td className="border border-slate-500 px-2 py-1">{customerType === 'new' ? '新規' : '既存'}</td>
          </tr>
          <tr>
            <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>顧客名</th>
            <td className="border border-slate-500 px-2 py-1" colSpan={3}>{customerName}</td>
          </tr>
          <tr>
            <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>住所</th>
            <td className="border border-slate-500 px-2 py-1" colSpan={3}>{customerAddress}</td>
          </tr>
          <tr>
            <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>居宅名</th>
            <td className="border border-slate-500 px-2 py-1">{officeName}</td>
            <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>担当ケアマネージャー</th>
            <td className="border border-slate-500 px-2 py-1">{careManager}</td>
          </tr>
          {serviceType === 'housing' && (
            <tr>
              <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>施工業者</th>
              <td className="border border-slate-500 px-2 py-1" colSpan={3}>{contractor}</td>
            </tr>
          )}
          <tr>
            <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>請求区分</th>
            <td className="border border-slate-500 px-2 py-1">
              {billingType === 'receipt' ? '受領委任払い' : '償還払い'}
            </td>
            <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>介護度</th>
            <td className="border border-slate-500 px-2 py-1">{careLevel}</td>
          </tr>
          <tr>
            <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>負担割合</th>
            <td className="border border-slate-500 px-2 py-1">{burdenLabel}</td>
            <th className="border border-slate-500 px-1.5 py-1 text-left text-[10px] leading-tight" style={{ background: PRINT_LABEL_BG }}>介護保険残額</th>
            <td className="border border-slate-500 px-2 py-1">{remaining === '' || remaining === null || remaining === undefined ? '—（超過なし）' : fmt(remaining)}</td>
          </tr>
        </tbody>
      </table>

      {/* 明細テーブル */}
      <table className="w-full table-fixed border-collapse border border-slate-500 mb-3">
        <colgroup>
          <col style={{ width: '6%' }} />
          {showPrintProductName && <col style={{ width: '28%' }} />}
          {showPrintColor && <col style={{ width: '14%' }} />}
          <col />
          {showExTax && <col />}
          {hasCost && <col />}
          {hasCost && showExTax && <col />}
        </colgroup>
        <thead>
          <tr style={{ background: PRINT_HEAD_BG }}>
            <th className="border border-slate-500 px-1.5 py-1 text-center">No</th>
            {showPrintProductName && <th className="border border-slate-500 px-1.5 py-1 text-left">商品名</th>}
            {showPrintColor && <th className="border border-slate-500 px-1.5 py-1 text-left">カラー</th>}
            <th className="border border-slate-500 px-1.5 py-1 text-right">{hasCost ? '工事合計金額(税込)' : '金額(税込)'}</th>
            {showExTax && <th className="border border-slate-500 px-1.5 py-1 text-right" style={{ background: PRINT_EXTAX_BG }}>{hasCost ? '工事合計金額(税抜)' : '金額(税抜)'}</th>}
            {hasCost && <th className="border border-slate-500 px-1.5 py-1 text-right">工事金額仕切り(税込)</th>}
            {hasCost && showExTax && <th className="border border-slate-500 px-1.5 py-1 text-right" style={{ background: PRINT_EXTAX_BG }}>工事金額仕切り(税抜)</th>}
          </tr>
        </thead>
        <tbody>
          {items.filter((it) => it.amount > 0).map((item, i) => (
            <tr key={item.id}>
              <td className="border border-slate-500 px-1.5 py-1 text-center align-top">{i + 1}</td>
              {showPrintProductName && (
                <td className="border border-slate-500 px-1.5 py-1 align-top break-words">{item.productName}</td>
              )}
              {showPrintColor && (
                <td className="border border-slate-500 px-1.5 py-1 align-top break-words">{item.color}</td>
              )}
              <td className="border border-slate-500 px-1.5 py-1 text-right align-top">{fmt(item.amount)}</td>
              {showExTax && (
                <td className="border border-slate-500 px-1.5 py-1 text-right align-top" style={{ background: PRINT_EXTAX_BG }}>{fmt(exTax(item.amount))}</td>
              )}
              {hasCost && (
                <td className="border border-slate-500 px-1.5 py-1 text-right align-top">{fmt(item.cost)}</td>
              )}
              {hasCost && showExTax && (
                <td className="border border-slate-500 px-1.5 py-1 text-right align-top" style={{ background: PRINT_EXTAX_BG }}>{fmt(exTax(item.cost))}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* 仕切り合計（住宅改修のみ）— 利益金額/利益率はハイライト */}
      {hasCost && total > 0 && (
        <div
          className="mb-3 px-2 py-1.5 text-xs inline-block font-bold"
          style={{ background: '#fff3a8', border: '1.2px solid #000' }}
        >
          <span className="mr-4">仕切り合計: {fmt(totalCost)}</span>
          <span className="mr-4">利益金額: {fmt(profit)}</span>
          <span>利益率: {profitRate}%</span>
        </div>
      )}

      {/* 個別切り上げ表示 */}
      {applyMiyako && (
        <p className="text-xs text-slate-600 mb-2">※ 個別切り上げ適用</p>
      )}

      {/* 計算結果テーブル */}
      <table className="w-full table-fixed border-collapse border border-slate-500 mb-3">
        <colgroup>
          <col />
          <col style={{ width: '25%' }} />
          {showExTax && <col style={{ width: '25%' }} />}
        </colgroup>
        <thead>
          <tr style={{ background: PRINT_HEAD_BG }}>
            <th className="border border-slate-500 px-2 py-1 text-left">項目</th>
            <th className="border border-slate-500 px-2 py-1 text-right">税込</th>
            {showExTax && <th className="border border-slate-500 px-2 py-1 text-right" style={{ background: PRINT_EXTAX_BG }}>税抜</th>}
          </tr>
        </thead>
        <tbody>
          {resultRows.map(([label, val]) => {
            const highlight = label.includes('利用者負担額') || label.includes('保険者負担額')
            const hlStyle = highlight ? { background: PRINT_MARK_BG } : undefined
            return (
              <tr key={label}>
                <td className="border border-slate-500 px-2 py-1" style={{ background: PRINT_LABEL_BG, ...(hlStyle || {}) }}>{label}</td>
                <td className="border border-slate-500 px-2 py-1 text-right" style={hlStyle}>{fmt(val)}</td>
                {showExTax && (
                  <td className="border border-slate-500 px-2 py-1 text-right" style={hlStyle || { background: PRINT_EXTAX_BG }}>{fmt(exTax(val))}</td>
                )}
              </tr>
            )
          })}
          {/* ご利用者お支払い合計は税込・税抜とも最も目立つ色で強調する */}
          <tr className="border border-slate-500 font-bold">
            <td className="border border-slate-500 px-2 py-1" style={{ background: PRINT_TOTAL_BG }}>ご利用者お支払い合計</td>
            <td className="border border-slate-500 px-2 py-1 text-right" style={{ background: PRINT_TOTAL_BG }}>{fmt(calc.totalUserBurden)}<span className="ml-1 text-[9px] font-normal">(税込)</span></td>
            {showExTax && (
              <td className="border border-slate-500 px-2 py-1 text-right" style={{ background: PRINT_TOTAL_BG }}>{fmt(exTax(calc.totalUserBurden))}<span className="ml-1 text-[9px] font-normal">(税抜)</span></td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
    </>
  )
}
