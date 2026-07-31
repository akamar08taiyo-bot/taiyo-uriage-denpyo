import { useEffect, useState } from 'react'
import UriageDenpyo from './components/UriageDenpyo.jsx'

const MASTER_STORAGE_KEY = 'fukushi_uriage_master_v1'

const DEFAULT_MASTER = {
  offices: ['本社'],
  salesPersons: [],
  contractors: [],
  defaultOffice: '本社',
  defaultSalesPerson: '',
}

const DEFAULT_BRIDGE = {
  enabled: false,
  customerName: '',
  customerAddress: '',
  officeName: '',
  careManager: '',
}

function cleanList(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
}

function loadMaster() {
  try {
    const saved = JSON.parse(localStorage.getItem(MASTER_STORAGE_KEY) || 'null')
    if (!saved || typeof saved !== 'object') return DEFAULT_MASTER
    return {
      offices: cleanList(saved.offices),
      salesPersons: cleanList(saved.salesPersons),
      contractors: cleanList(saved.contractors),
      defaultOffice: String(saved.defaultOffice || '').trim(),
      defaultSalesPerson: String(saved.defaultSalesPerson || '').trim(),
    }
  } catch {
    return DEFAULT_MASTER
  }
}

export default function App() {
  const [bridge, setBridge] = useState(DEFAULT_BRIDGE)
  const [master, setMaster] = useState(loadMaster)

  useEffect(() => {
    localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify(master))
  }, [master])

  return (
    <UriageDenpyo
      master={master}
      setMaster={setMaster}
      bridge={bridge}
      setBridge={setBridge}
    />
  )
}
