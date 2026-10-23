/**
 * Component: SearchFiltersSection
 * Real filters on the search page: category + price range (Jan Aushadhi price).
 * Apply -> opens the results with these filters. Data: GET /api/v1/medicines/filters.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HiOutlineFunnel, HiOutlineChevronDown, HiOutlineChevronUp } from 'react-icons/hi2'
import medicineService from '../../../services/medicineService'

function SearchFiltersSection({ onApply }) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  const { data } = useQuery({
    queryKey: ['medicines', 'filters'],
    queryFn: async () => (await medicineService.getFilters()).data,
    staleTime: 10 * 60 * 1000,
  })
  const categories = data?.categories ?? []

  const hasFilter = category || minPrice !== '' || maxPrice !== ''

  function reset() {
    setCategory('')
    setMinPrice('')
    setMaxPrice('')
  }

  function apply() {
    onApply?.({
      category: category || undefined,
      min_price: minPrice !== '' ? minPrice : undefined,
      max_price: maxPrice !== '' ? maxPrice : undefined,
    })
  }

  return (
    <section aria-labelledby="filters-heading" className="py-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 text-sm font-semibold text-slate-800"
      >
        <HiOutlineFunnel size={16} className="text-slate-400" aria-hidden="true" />
        <span id="filters-heading">Filter by category and price</span>
        {open ? <HiOutlineChevronUp size={14} aria-hidden="true" /> : <HiOutlineChevronDown size={14} aria-hidden="true" />}
      </button>

      {open && (
        <div className="mt-3 p-4 rounded-xl bg-white border border-slate-100 shadow-sm grid gap-4 sm:grid-cols-3">
          <label className="text-xs text-slate-500 flex flex-col gap-1 sm:col-span-3">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-800"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
              ))}
            </select>
          </label>

          <label className="text-xs text-slate-500 flex flex-col gap-1">
            Min price (₹)
            <input
              type="number" min="0" inputMode="decimal" value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-800"
            />
          </label>
          <label className="text-xs text-slate-500 flex flex-col gap-1">
            Max price (₹)
            <input
              type="number" min="0" inputMode="decimal" value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-800"
            />
          </label>

          <div className="flex items-end gap-2">
            <button
              type="button" onClick={apply} disabled={!hasFilter}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-40"
            >
              Show medicines
            </button>
            <button type="button" onClick={reset} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800">
              Reset
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default SearchFiltersSection