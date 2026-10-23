/**
 * Component: SearchSummarySection
 * Header of the results page: what was searched and the real number of matches.
 */
import { Link } from 'react-router-dom'
import { HiOutlineArrowLeft, HiOutlineMagnifyingGlass } from 'react-icons/hi2'
import { ROUTES } from '../../../constants/routes'

function SearchSummarySection({ query = '', category = '', resultCount = 0, loading = false }) {
  const what = query.trim() ? `\u201c${query.trim()}\u201d` : category || 'all medicines'

  return (
    <section aria-labelledby="search-summary-heading" className="pb-4">
      <Link
        to={ROUTES.USER.SEARCH}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-primary-600 transition-colors mb-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        aria-label="Back to medicine search"
      >
        <HiOutlineArrowLeft size={13} aria-hidden="true" />
        Back to Search
      </Link>

      <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-white border border-slate-100 shadow-sm">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary-100 shrink-0">
            <HiOutlineMagnifyingGlass size={18} className="text-primary-700" aria-hidden="true" />
          </div>
          <h1 id="search-summary-heading" className="text-sm font-semibold text-slate-800 break-words">
            {loading ? 'Searching' : (
              <>
                <span className="text-primary-700 font-bold">{resultCount} {resultCount === 1 ? 'medicine' : 'medicines'}</span>
                {' '}for{' '}
              </>
            )}
            <span className="italic text-slate-700">{loading ? ` ${what}…` : what}</span>
          </h1>
        </div>
      </div>
    </section>
  )
}

export default SearchSummarySection