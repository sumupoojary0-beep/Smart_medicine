/**
 * Component: MedicineCategoriesSection
 * Real categories from the catalogue, with how many medicines each has.
 * Data: GET /api/v1/medicines/filters. Click -> results filtered by category.
 */
import { useQuery } from '@tanstack/react-query'
import { MdMedication } from 'react-icons/md'
import medicineService from '../../../services/medicineService'

function MedicineCategoriesSection({ onCategorySelect }) {
  const { data, isLoading } = useQuery({
    queryKey: ['medicines', 'filters'],
    queryFn: async () => (await medicineService.getFilters()).data,
    staleTime: 10 * 60 * 1000,
  })
  const categories = data?.categories ?? []

  if (!isLoading && !categories.length) return null

  return (
    <section aria-labelledby="categories-heading" className="py-6">
      <div className="mb-5">
        <h2 id="categories-heading" className="text-base font-bold text-slate-900">Browse by Category</h2>
        <p className="text-xs text-slate-500 mt-0.5">Pick a category to see its medicines.</p>
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-400">Loading categories...</p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" aria-label="Medicine categories">
          {categories.map((cat) => (
            <li key={cat.name}>
              <button
                type="button"
                onClick={() => onCategorySelect?.(cat.name)}
                className="group w-full flex items-center gap-3 p-3 rounded-xl bg-white border border-slate-100 shadow-sm text-left hover:shadow-md hover:border-primary-200 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary-100 shrink-0">
                  <MdMedication size={18} className="text-primary-700" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800 group-hover:text-primary-700 truncate">{cat.name}</span>
                  <span className="block text-[11px] text-slate-400">{cat.count} medicines</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default MedicineCategoriesSection