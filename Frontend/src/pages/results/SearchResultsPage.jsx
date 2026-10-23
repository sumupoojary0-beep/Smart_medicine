/**
 * Component: SearchResultsPage
 *
 * Real search results, driven by the URL:
 *   /search/results?q=&category=&min_price=&max_price=&sort=
 * Sorting and filtering happen on the server (so they cover ALL matches, not
 * just the first page), results load 24 at a time with "Load more", and the
 * count shown is the real total.
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import SearchSummarySection from './sections/SearchSummarySection'
import ResultsToolbar       from './sections/ResultsToolbar'
import ResultsGrid          from './sections/ResultsGrid'
import SearchEmptyState     from '../search/sections/SearchEmptyState'
import SearchErrorState     from '../search/sections/SearchErrorState'
import SearchLoadingSection from '../search/sections/SearchLoadingSection'
import medicineService, { mapMedicineToCard } from '../../services/medicineService'
import { addRecentSearch } from '../../hooks/useRecentSearches'
import { ROUTES } from '../../constants/routes'

const PAGE_SIZE = 24

// ======================================
// Filter panel (category + price)
// ======================================
function FilterPanel({ category, minPrice, maxPrice, onChange }) {
  const { data } = useQuery({
    queryKey: ['medicines', 'filters'],
    queryFn: async () => (await medicineService.getFilters()).data,
    staleTime: 10 * 60 * 1000,
  })
  const categories = data?.categories ?? []
  const [min, setMin] = useState(minPrice)
  const [max, setMax] = useState(maxPrice)

  return (
    <div className="mt-3 p-4 rounded-xl bg-white border border-slate-100 shadow-sm grid gap-3 sm:grid-cols-4">
      <label className="text-xs text-slate-500 flex flex-col gap-1 sm:col-span-2">
        Category
        <select
          value={category}
          onChange={(e) => onChange({ category: e.target.value })}
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
          type="number" min="0" inputMode="decimal" value={min}
          onChange={(e) => setMin(e.target.value)}
          onBlur={() => onChange({ min_price: min })}
          onKeyDown={(e) => e.key === 'Enter' && onChange({ min_price: min, max_price: max })}
          className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-800"
        />
      </label>
      <label className="text-xs text-slate-500 flex flex-col gap-1">
        Max price (₹)
        <input
          type="number" min="0" inputMode="decimal" value={max}
          onChange={(e) => setMax(e.target.value)}
          onBlur={() => onChange({ max_price: max })}
          onKeyDown={(e) => e.key === 'Enter' && onChange({ min_price: min, max_price: max })}
          className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-800"
        />
      </label>
    </div>
  )
}

// ======================================
// Search Results Page
// ======================================
function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const query    = searchParams.get('q') ?? ''
  const category = searchParams.get('category') ?? ''
  const minPrice = searchParams.get('min_price') ?? ''
  const maxPrice = searchParams.get('max_price') ?? ''
  const sortBy   = searchParams.get('sort') ?? 'relevance'

  const [layout, setLayout] = useState('grid')
  const [filterOpen, setFilterOpen] = useState(
    () => Boolean(category || minPrice || maxPrice),
  )

  const hasSearch = Boolean(query.trim() || category || minPrice || maxPrice)

  // Change one or more URL params; empty values are removed. Page resets.
  const updateParams = useCallback((changes) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      Object.entries(changes).forEach(([key, value]) => {
        if (value === '' || value == null || (key === 'sort' && value === 'relevance')) next.delete(key)
        else next.set(key, value)
      })
      return next
    }, { replace: true })
  }, [setSearchParams])

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
  } = useInfiniteQuery({
    queryKey: ['medicines', 'search', query, category, minPrice, maxPrice, sortBy],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data: body } = await medicineService.search({
        q: query.trim() || undefined,
        category: category || undefined,
        min_price: minPrice !== '' ? minPrice : undefined,
        max_price: maxPrice !== '' ? maxPrice : undefined,
        sort: sortBy,
        page: pageParam,
        page_size: PAGE_SIZE,
      })
      return body
    },
    getNextPageParam: (last) =>
      last.page * last.page_size < last.total ? last.page + 1 : undefined,
    enabled: hasSearch,
  })

  const medicines = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.results ?? []).map(mapMedicineToCard),
    [data],
  )
  const total = data?.pages?.[0]?.total ?? 0
  const resolvedFrom = data?.pages?.[0]?.resolved_from

  // Remember searches that actually found something (this device only)
  useEffect(() => {
    if (query.trim() && total > 0 && !isFetching) addRecentSearch(query)
  }, [query, total, isFetching])

  // "Best value" = the loaded medicine with the biggest REAL saving; none if no brand data
  const bestValueId = useMemo(() => {
    let best = null
    let bestPct = 0
    medicines.forEach((m) => {
      const pct = m.mrp > m.price && m.price > 0 ? (m.mrp - m.price) / m.mrp : 0
      if (pct > bestPct) { best = m.id; bestPct = pct }
    })
    return best ?? 'none'
  }, [medicines])

  const handleViewMedicine = useCallback((id) => {
    navigate(ROUTES.USER.MEDICINE_DETAIL.replace(':id', id))
  }, [navigate])

  const activeFilters = [
    category && { key: 'category', label: category },
    minPrice !== '' && { key: 'min_price', label: `Min ₹${minPrice}` },
    maxPrice !== '' && { key: 'max_price', label: `Max ₹${maxPrice}` },
  ].filter(Boolean)

  return (
    <article aria-label="Search Results">

      <SearchSummarySection query={query} category={category} resultCount={total} loading={isLoading} />

      <ResultsToolbar
        layout={layout}
        onLayoutChange={setLayout}
        sortBy={sortBy}
        onSortChange={(value) => updateParams({ sort: value })}
        onFilterToggle={() => setFilterOpen((o) => !o)}
        filterActive={filterOpen || activeFilters.length > 0}
        resultCount={total}
      />

      {filterOpen && (
        <FilterPanel
          key={`${minPrice}-${maxPrice}`}
          category={category}
          minPrice={minPrice}
          maxPrice={maxPrice}
          onChange={updateParams}
        />
      )}

      {activeFilters.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {activeFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => updateParams({ [f.key]: '' })}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-50 border border-primary-200 text-xs font-medium text-primary-700 hover:bg-primary-100"
              aria-label={`Remove filter ${f.label}`}
            >
              {f.label} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}

      {resolvedFrom && (
        <p className="mt-3 text-xs text-slate-600 bg-primary-50 border border-primary-100 rounded-lg px-3 py-2">
          &ldquo;{resolvedFrom.query}&rdquo; is not in the Jan Aushadhi list, so these are generic
          medicines with the same ingredient ({resolvedFrom.ingredients.join(', ')}). Confirm the
          right strength with your pharmacist.
        </p>
      )}

      <div className="mt-4">
        {!hasSearch ? (
          <SearchEmptyState query="" onRetry={() => navigate(ROUTES.USER.SEARCH)} />
        ) : isLoading ? (
          <SearchLoadingSection variant="results" />
        ) : isError ? (
          <SearchErrorState onRetry={() => refetch()} />
        ) : medicines.length > 0 ? (
          <>
            <ResultsGrid
              medicines={medicines}
              layout={layout}
              bestValueId={bestValueId}
              onView={handleViewMedicine}
            />
            <div className="mt-6 flex flex-col items-center gap-2">
              <p className="text-xs text-slate-400">
                Showing {medicines.length} of {total}
              </p>
              {hasNextPage && (
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="px-5 py-2 rounded-lg border border-primary-300 text-sm font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                >
                  {isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          </>
        ) : (
          <SearchEmptyState query={query} onRetry={() => navigate(ROUTES.USER.SEARCH)} />
        )}
      </div>

    </article>
  )
}

export default SearchResultsPage