/**
 * PharmacyRankingPreferences
 *
 * Set once in Profile: how much each factor matters when choosing the
 * best Jan Aushadhi Kendra. Saved to the account and applied automatically
 * to every medicine search (Weighted Sum Model on the backend).
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { HiOutlineAdjustmentsHorizontal } from 'react-icons/hi2'
import Button from '../ui/Button'
import userPreferenceService from '../../services/userPreferenceService'

// Every Jan Aushadhi batch is verified, so "supplier trust" is not offered
// here (it is always saved with weight 0).
const FACTORS = [
  { key: 'distance',  label: 'Nearest to me',     hint: 'Closer Kendras rank higher' },
  { key: 'price',     label: 'Lowest price',      hint: 'Cheaper stock ranks higher' },
  { key: 'quantity',  label: 'Plenty in stock',   hint: 'More units available ranks higher' },
  { key: 'freshness', label: 'Longer shelf life', hint: 'Medicine further from expiry ranks higher' },
]

const PRESETS = [
  { name: 'Balanced',     values: { distance: 40, price: 25, quantity: 25, freshness: 10 } },
  { name: 'Nearest',      values: { distance: 65, price: 15, quantity: 15, freshness: 5 } },
  { name: 'Cheapest',     values: { distance: 20, price: 55, quantity: 15, freshness: 10 } },
  { name: 'Best stocked', values: { distance: 20, price: 15, quantity: 55, freshness: 10 } },
]

/** Saved weights (0-1, may still include an old "trust" share) -> whole percentages that add up to 100. */
function toPercent(w) {
  const raw = FACTORS.map(({ key }) => Math.max(0, w?.[key] ?? 0))
  const sum = raw.reduce((s, n) => s + n, 0)
  if (sum <= 0) return { ...PRESETS[0].values }
  const scaled = raw.map((n) => (n / sum) * 100)
  const floors = scaled.map(Math.floor)
  let leftover = 100 - floors.reduce((s, n) => s + n, 0)
  scaled
    .map((r, i) => [r - Math.floor(r), i])
    .sort((x, y) => y[0] - x[0])
    .forEach(([, i]) => { if (leftover > 0) { floors[i] += 1; leftover -= 1 } })
  return Object.fromEntries(FACTORS.map(({ key }, i) => [key, floors[i]]))
}

/** Percentages -> the five weights the backend expects (trust is always 0). */
const toWeights = (p) => ({
  ...Object.fromEntries(FACTORS.map(({ key }) => [key, p[key] / 100])),
  trust: 0,
})
const sameValues = (a, b) => FACTORS.every(({ key }) => a[key] === b[key])

/** Move one slider; share the rest proportionally so the total stays exactly 100. */
function rebalance(values, changedKey, newValue) {
  const target = Math.max(0, Math.min(100, Math.round(newValue)))
  const others = FACTORS.map((f) => f.key).filter((k) => k !== changedKey)
  const remaining = 100 - target
  const otherSum = others.reduce((s, k) => s + values[k], 0)

  const raw = others.map((k) => (otherSum > 0 ? (values[k] / otherSum) * remaining : remaining / others.length))
  const floors = raw.map(Math.floor)
  let leftover = remaining - floors.reduce((s, n) => s + n, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (leftover <= 0) break
    floors[i] += 1
    leftover -= 1
  }
  const next = { [changedKey]: target }
  others.forEach((k, i) => { next[k] = floors[i] })
  return next
}

/** Loads the saved preferences, then shows the form (the form starts from the loaded values). */
export default function PharmacyRankingPreferences() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ranking-preferences'],
    queryFn: async () => (await userPreferenceService.getRankingPreferences()).data,
  })

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5" aria-busy="true">
        <p className="text-xs text-slate-400">Loading your preferences…</p>
      </div>
    )
  }

  const initial = data?.preferences ? toPercent(data.preferences) : PRESETS[0].values
  return <PreferencesForm initial={initial} loadFailed={isError} />
}

function PreferencesForm({ initial, loadFailed }) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState(initial)
  const [savedValues, setSavedValues] = useState(initial)
  const isLoading = false
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null) // { type, text }

  const dirty = !sameValues(values, savedValues)
  const total = FACTORS.reduce((s, { key }) => s + values[key], 0)

  async function refreshRankings() {
    // searches already on screen must pick up the new preferences
    await queryClient.invalidateQueries({ queryKey: ['kendras'] })
    await queryClient.invalidateQueries({ queryKey: ['medicine-nearby-kendras'] })
    await queryClient.invalidateQueries({ queryKey: ['ranking-preferences'] })
  }

  async function handleSave() {
    setBusy(true)
    setMessage(null)
    try {
      await userPreferenceService.saveRankingPreferences(toWeights(values))
      setSavedValues(values)
      setMessage({ type: 'success', text: 'Saved. Every medicine search will now rank Kendras this way.' })
      await refreshRankings()
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.detail || error.message || 'Could not save your preferences.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleReset() {
    setBusy(true)
    setMessage(null)
    try {
      const { data: reset } = await userPreferenceService.resetRankingPreferences()
      const p = toPercent(reset?.preferences ?? toWeights(PRESETS[0].values))
      setValues(p)
      setSavedValues(p)
      setMessage({ type: 'success', text: 'Back to the default (Balanced) ranking.' })
      await refreshRankings()
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.detail || 'Could not reset your preferences.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <h2 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2 border-b border-slate-100 pb-2">
        <HiOutlineAdjustmentsHorizontal size={15} className="text-primary-600" aria-hidden="true" />
        Best-Pharmacy Preferences
      </h2>
      <p className="text-[11px] text-slate-500 mb-4">
        Choose what matters most to you. We use this every time you look for a medicine, so the best Kendra for you comes first.
      </p>

      {loadFailed && (
        <p role="alert" className="text-xs text-danger-700 bg-danger-50 rounded-lg px-3 py-2 mb-3">
          Could not load your saved preferences. You can still set new ones below.
        </p>
      )}

      {/* Presets */}
      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Quick presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            disabled={busy || isLoading}
            onClick={() => setValues(preset.values)}
            aria-pressed={sameValues(values, preset.values)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors disabled:opacity-50 ${
              sameValues(values, preset.values)
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* Sliders */}
      <div className="space-y-4">
        {FACTORS.map(({ key, label, hint }) => (
          <div key={key}>
            <div className="flex items-baseline justify-between">
              <label htmlFor={`pref-${key}`} className="text-xs font-semibold text-slate-700">{label}</label>
              <span className="text-xs font-bold text-primary-700 tabular-nums">{values[key]}%</span>
            </div>
            <input
              id={`pref-${key}`}
              type="range"
              min="0"
              max="100"
              step="1"
              value={values[key]}
              disabled={busy || isLoading}
              onChange={(e) => setValues((v) => ({ ...v, ...rebalance(v, key, Number(e.target.value)) }))}
              className="w-full accent-primary-600"
              aria-describedby={`pref-${key}-hint`}
            />
            <p id={`pref-${key}-hint`} className="text-[10px] text-slate-400">{hint}</p>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-500 mt-3">
        Total: <span className="font-bold text-slate-700">{total}%</span>. Moving one slider automatically adjusts the others so the total stays 100%.
      </p>

      {message && (
        <p
          role={message.type === 'error' ? 'alert' : 'status'}
          className={`text-xs rounded-lg px-3 py-2 mt-3 ${
            message.type === 'error' ? 'text-danger-700 bg-danger-50' : 'text-success-700 bg-success-50'}`}
        >
          {message.text}
        </p>
      )}

      <div className="flex items-center gap-3 mt-4">
        <Button type="button" variant="primary" loading={busy} disabled={!dirty || busy || isLoading || total !== 100} onClick={handleSave}>
          Save preferences
        </Button>
        <Button type="button" variant="outline" disabled={busy || isLoading} onClick={handleReset}>
          Reset to default
        </Button>
      </div>
    </div>
  )
}