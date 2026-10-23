/**
 * Component: PopularMedicinesSection
 * "Biggest savings": real medicines whose Jan Aushadhi price is far below the
 * brand price. Data: GET /api/v1/medicines/top-savings. Hidden if none.
 */
import { useQuery } from '@tanstack/react-query'
import { HiOutlineFire } from 'react-icons/hi2'
import { MdMedication } from 'react-icons/md'
import medicineService from '../../../services/medicineService'

function PopularMedicinesSection({ onSearch }) {
  const { data } = useQuery({
    queryKey: ['medicines', 'top-savings'],
    queryFn: async () => (await medicineService.getTopSavings(12)).data,
    staleTime: 10 * 60 * 1000,
  })
  const items = data?.results ?? []

  if (!items.length) return null

  return (
    <section aria-labelledby="popular-medicines-heading" className="py-4">
      <div className="flex items-center gap-1.5 mb-3">
        <HiOutlineFire size={15} className="text-warning-500" aria-hidden="true" />
        <h2 id="popular-medicines-heading" className="text-sm font-semibold text-slate-800">
          Biggest Savings
        </h2>
      </div>

      <ul className="flex flex-wrap gap-2" aria-label="Medicines with the biggest savings — click to search">
        {items.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onSearch?.(m.brand_name || m.generic_name)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-white border border-slate-200 text-sm text-slate-700 hover:border-primary-300 hover:text-primary-700 hover:bg-primary-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <MdMedication size={14} className="text-primary-500" aria-hidden="true" />
              <span className="font-medium">{m.brand_name || m.generic_name}</span>
              <span className="text-[11px] font-semibold text-success-600">Save {Math.round(m.saving_pct)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default PopularMedicinesSection