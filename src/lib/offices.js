// 価格改定・休暇案内アプリと共通の全19営業所。既存の独自候補は選択欄に追加して保持する。
export const OFFICE_NAMES = [
  "小倉営業所",
  "小倉南営業所",
  "八幡西営業所",
  "八幡東営業所",
  "行橋営業所",
  "田川営業所",
  "飯塚営業所",
  "福岡南営業所",
  "福岡西営業所",
  "福岡東営業所",
  "久留米営業所",
  "大牟田営業所",
  "佐賀営業所",
  "長崎営業所",
  "大村営業所",
  "壱岐営業所",
  "熊本営業所",
  "熊本北営業所",
  "大分営業所"
]

export const officeChoices = (custom = [], current = '') => [...new Set([
  ...OFFICE_NAMES,
  ...(Array.isArray(custom) ? custom : []),
  current,
].filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim()))]
