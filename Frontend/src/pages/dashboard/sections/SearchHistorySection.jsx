/** Recent searches (this device): what this user really searched. */
import { useNavigate } from 'react-router-dom'
import { HiOutlineMagnifyingGlass, HiOutlineXMark, HiOutlineClock } from 'react-icons/hi2'
import { ROUTES } from '../../../constants/routes'
import useRecentSearches from '../../../hooks/useRecentSearches'

function SearchHistorySection() {
  const { items, remove, clear } = useRecentSearches()
  const navigate = useNavigate()

  return (
    <section aria-labelledby="search-history-heading">
      <div className="flex items-center justify-between mb-3">
        <h2 id="search-history-heading" className="text-base font-bold text-slate-900 flex items-center gap-2">
          <HiOutlineClock size={16} className="text-slate-400" aria-hidden="true" />
          Recent Searches
        </h2>
        {items.length > 0 && (
          <button
            type="button" onClick={clear} aria-label="Clear all search history"
            className="text-xs text-slate-400 hover:text-danger-500 transition-colors rounded"
          >
            Clear all
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">No searches yet.</div>
      ) : (
        <ul className="bg-white rounded-xl border border-slate-100 shadow-sm divide-y divide-slate-50">
          {items.map((query) => (
            <li key={query} className="flex items-center gap-3 px-4 py-2.5 group">
              <HiOutlineMagnifyingGlass size={14} className="text-slate-300 shrink-0" aria-hidden="true" />
              <button
                type="button"
                onClick={() => navigate(`${ROUTES.USER.SEARCH_RESULTS}?q=${encodeURIComponent(query)}`)}
                className="flex-1 text-left text-sm text-slate-700 hover:text-primary-700 truncate"
              >
                {query}
              </button>
              <button
                type="button" onClick={() => remove(query)} aria-label={`Remove ${query}`}
                className="text-slate-300 hover:text-danger-500"
              >
                <HiOutlineXMark size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default SearchHistorySection