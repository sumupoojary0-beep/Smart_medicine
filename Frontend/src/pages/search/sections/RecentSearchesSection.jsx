/**
 * Component: RecentSearchesSection
 * Shows what THIS user searched before (saved on this device). Hidden when empty.
 */
import { HiOutlineClock, HiOutlineXMark } from 'react-icons/hi2'
import useRecentSearches from '../../../hooks/useRecentSearches'

function RecentSearchesSection({ onSearch }) {
  const { items, remove, clear } = useRecentSearches()

  if (!items.length) return null

  return (
    <section aria-labelledby="recent-searches-heading" className="py-4">
      <div className="flex items-center justify-between mb-3">
        <h2 id="recent-searches-heading" className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
          <HiOutlineClock size={15} className="text-slate-400" aria-hidden="true" />
          Recent Searches
        </h2>
        <button
          type="button"
          onClick={clear}
          aria-label="Clear all recent searches"
          className="text-xs font-medium text-slate-400 hover:text-danger-500 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-400"
        >
          Clear all
        </button>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        {items.map((query) => (
          <li key={query} className="flex items-center gap-2 group">
            <button
              type="button"
              onClick={() => onSearch?.(query)}
              className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm text-slate-700 hover:bg-slate-50 transition-colors truncate"
            >
              <HiOutlineClock size={14} className="text-slate-300 shrink-0" aria-hidden="true" />
              <span className="truncate">{query}</span>
            </button>
            <button
              type="button"
              onClick={() => remove(query)}
              aria-label={`Remove ${query} from recent searches`}
              className="p-1.5 rounded text-slate-300 hover:text-danger-500 hover:bg-danger-50 transition-colors"
            >
              <HiOutlineXMark size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default RecentSearchesSection