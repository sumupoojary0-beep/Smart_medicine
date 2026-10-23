/**
 * Component: MedicineInfoTabs
 *
 * Shows ONLY information that really exists in the medicines database:
 *   - Overview      -> generic name, category, manufacturer, pack size
 *   - Composition   -> the real composition, split into ingredient + strength
 *   - Generic       -> the Jan Aushadhi generic for this medicine
 *   - Safety note   -> dosage / side effects are NOT stored, so we say so
 *                      instead of showing made-up medical information.
 */

import { useState, useCallback, useMemo } from 'react'
import { HiOutlineInformationCircle } from 'react-icons/hi2'

// "Famotidine 20 mg + Domperidone 10 mg"  ->  [{name, strength}, ...]
function parseComposition(text) {
  if (!text || typeof text !== 'string') return []
  return text
    .split(/\s*(?:\+|,| and )\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(
        /^(.*?)[\s(]*(\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|ml|iu|%)(?:\s*\/\s*\d+(?:\.\d+)?\s*ml)?)\)?\s*(.*)$/i,
      )
      if (!m) return { name: part, strength: '—' }
      const name = `${m[1]} ${m[3]}`.replace(/\s+/g, ' ').trim()
      return { name: name || part, strength: m[2].replace(/\s+/g, ' ') }
    })
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 text-right">{value || '—'}</span>
    </div>
  )
}

function MedicineInfoTabs({ medicine, generic }) {
  const [activeTab, setActiveTab] = useState('overview')

  const ingredients = useMemo(
    () => parseComposition(medicine?.composition),
    [medicine?.composition],
  )

  const TABS = useMemo(() => [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="rounded-xl bg-slate-50 border border-slate-200 divide-y divide-slate-100">
          <Row label="Generic name" value={medicine?.genericName} />
          <Row label="Category" value={medicine?.category} />
          <Row label="Manufacturer" value={medicine?.manufacturer} />
          <Row label="Pack size" value={medicine?.type} />
          <Row label="PMBI code" value={medicine?.pmbiCode} />
        </div>
      ),
    },
    {
      id: 'composition',
      label: 'Composition',
      content: ingredients.length === 0 ? (
        <p className="text-sm text-slate-500">
          Composition is not available for this medicine. Please check the pack or ask your pharmacist.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Active ingredient</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Strength</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ingredients.map((ing, i) => (
                  <tr key={`${ing.name}-${i}`}>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{ing.name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{ing.strength}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            As listed in the Jan Aushadhi product list: {medicine.composition}
          </p>
        </div>
      ),
    },
    {
      id: 'generics',
      label: 'Generic Alternative',
      content: generic ? (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">
            This Jan Aushadhi medicine has the same active composition as the branded version.
          </p>
          <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-50 border border-slate-100">
            <span className="text-slate-700 font-medium">
              {generic.name}{generic.composition ? ` — ${generic.composition}` : ''}
            </span>
            {Number(generic.price) > 0 && (
              <span className="text-xs text-success-600 font-semibold">₹{Number(generic.price).toFixed(2)}</span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">No generic alternative information available.</p>
      ),
    },
    {
      id: 'safety',
      label: 'Dosage & Safety',
      content: (
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Dosage, side effects and precautions are not stored in this system, so we do not show
            them here to avoid giving wrong medical information.
          </p>
          <p className="text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded-lg px-3 py-2">
            Always follow your doctor's prescription and read the leaflet inside the pack.
            Ask your pharmacist if you are unsure.
          </p>
        </div>
      ),
    },
  ], [medicine, generic, ingredients])

  const handleKeyDown = useCallback((e, i) => {
    if (e.key === 'ArrowRight') setActiveTab(TABS[(i + 1) % TABS.length].id)
    else if (e.key === 'ArrowLeft') setActiveTab(TABS[(i - 1 + TABS.length) % TABS.length].id)
  }, [TABS])

  const activeContent = TABS.find((t) => t.id === activeTab)?.content

  return (
    <section aria-labelledby="medicine-info-tabs-heading">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-6 pt-5 pb-0 border-b border-slate-100">
          <HiOutlineInformationCircle size={18} className="text-primary-600 shrink-0" aria-hidden="true" />
          <h2 id="medicine-info-tabs-heading" className="text-base font-bold text-slate-900">
            Medicine Information
          </h2>
        </div>

        <div
          role="tablist"
          aria-label="Medicine information sections"
          className="flex overflow-x-auto border-b border-slate-100 px-2 gap-1 scrollbar-hide"
        >
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`tabpanel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={[
                'shrink-0 px-4 py-3 text-xs font-semibold border-b-2 transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500',
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-700 bg-primary-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`tabpanel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          className="p-6"
        >
          {activeContent}
        </div>
      </div>
    </section>
  )
}

export default MedicineInfoTabs