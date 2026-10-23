/** Saved medicines: the user's real saved list (heart on a medicine's page). */
import { Link } from 'react-router-dom'
import { HiOutlineArrowRight, HiOutlineTrash } from 'react-icons/hi2'
import { MdMedication } from 'react-icons/md'
import Badge from '../../../components/ui/Badge'
import { ROUTES } from '../../../constants/routes'
import useSavedMedicines from '../../../hooks/useSavedMedicines'

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

function SavedMedicineCard({ medicine, onRemove, busy }) {
  const price = Number(medicine.jan_aushadhi_mrp) || 0
  const brand = Number(medicine.branded_avg_mrp) || 0
  return (
    <article
      aria-label={medicine.brand_name}
      className="flex items-start gap-3 p-4 rounded-xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary-50 shrink-0">
        <MdMedication size={20} className="text-primary-600" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-slate-900 truncate">{medicine.brand_name}</h3>
        <p className="text-[11px] text-slate-400 mt-0.5 truncate">{medicine.composition || medicine.generic_name}</p>
        <p className="text-xs text-slate-700 mt-1">
          <span className="font-bold text-primary-700">₹{price}</span>
          {brand > price && <span className="text-slate-400"> · brand ₹{brand}</span>}
        </p>
        <p className="text-[10px] text-slate-400 mt-1">Saved {formatDate(medicine.saved_at)}</p>
        <div className="flex items-center gap-1.5 mt-2">
          <Link
            to={ROUTES.USER.MEDICINE_DETAIL.replace(':id', medicine.id)}
            className="flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:text-primary-700 px-2 py-1 rounded-lg hover:bg-primary-50"
          >
            <HiOutlineArrowRight size={11} aria-hidden="true" /> View
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(medicine.pmbi_code)}
            aria-label={`Remove ${medicine.brand_name} from saved`}
            className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-danger-500 px-2 py-1 rounded-lg hover:bg-danger-50 ml-auto disabled:opacity-50"
          >
            <HiOutlineTrash size={11} aria-hidden="true" /> Remove
          </button>
        </div>
      </div>
    </article>
  )
}

function SavedMedicinesSection() {
  const { items, isLoading, isError, toggle, isToggling } = useSavedMedicines()

  return (
    <section aria-labelledby="saved-medicines-heading">
      <div className="flex items-center justify-between mb-3">
        <h2 id="saved-medicines-heading" className="text-base font-bold text-slate-900">Saved Medicines</h2>
        <Badge variant="primary" size="sm">{items.length}</Badge>
      </div>
      {isLoading ? (
        <p className="py-6 text-sm text-slate-400">Loading…</p>
      ) : isError ? (
        <p className="py-6 text-sm text-danger-600">Could not load your saved medicines.</p>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm">
          No saved medicines yet. Open any medicine and tap &ldquo;Save Medicine&rdquo;.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((m) => (
            <SavedMedicineCard key={m.pmbi_code} medicine={m} busy={isToggling} onRemove={toggle} />
          ))}
        </div>
      )}
    </section>
  )
}

export default SavedMedicinesSection