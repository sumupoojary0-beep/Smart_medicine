/**
 * Component: AddMedicinePage
 *
 * Route: /pharmacy/inventory/add
 *
 * Lets a pharmacy owner add stock for a medicine from the Jan Aushadhi
 * catalogue:
 *   1. search the catalogue (brand, generic name, composition, PMBI code)
 *   2. pick the medicine
 *   3. enter the batch details (batch no., expiry, quantity, price ...)
 *   4. save -> POST /api/v1/kendras/:kendraId/restock
 *
 * The owner's Kendra comes from the logged-in account
 * (currentUser.assignedKendraId). Demo accounts have no Kendra, so they can
 * search and fill the form but cannot save.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  HiOutlineArrowLeft,
  HiOutlineMagnifyingGlass,
  HiOutlineExclamationTriangle,
  HiOutlineCheckCircle,
} from 'react-icons/hi2'

import Button from '../../components/ui/Button'
import { ROUTES } from '../../constants/routes'
import { useAuth } from '../../contexts/AuthContext'
import useDebounce from '../../hooks/useDebounce'
import kendraService from '../../services/kendraService'
import medicineService from '../../services/medicineService'

const INPUT_CLASS =
  'mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 text-sm outline-none focus:border-primary-500'

const VERIFICATION_OPTIONS = [
  { value: 'unverified', label: 'Unverified' },
  { value: 'distributor', label: 'Authorised distributor' },
  { value: 'verified', label: 'Verified (BPPI / PMBI supply)' },
]

function todayPlusDays(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatPrice(value) {
  const number = Number(value)
  return Number.isFinite(number) ? `₹${number.toFixed(2)}` : '—'
}

function AddMedicinePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { currentUser } = useAuth()
  const kendraId = currentUser?.assignedKendraId ?? null

  const [searchText, setSearchText] = useState('')
  const [selected, setSelected] = useState(null)

  const [batchNumber, setBatchNumber] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [quantity, setQuantity] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [sellingPrice, setSellingPrice] = useState('')
  const [verification, setVerification] = useState('unverified')
  const [error, setError] = useState('')

  const debouncedSearch = useDebounce(searchText.trim(), 350)

  const searchQuery = useQuery({
    queryKey: ['medicines', 'add-stock-search', debouncedSearch],
    queryFn: async () =>
      (
        await medicineService.search({
          q: debouncedSearch,
          page: 1,
          page_size: 15,
        })
      ).data,
    enabled: debouncedSearch.length >= 2 && !selected,
  })

  const results = searchQuery.data?.results ?? []
  const resolvedFrom = searchQuery.data?.resolved_from

  const restockMutation = useMutation({
    mutationFn: (payload) => kendraService.restock(kendraId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kendra', kendraId] })
      navigate(ROUTES.PHARMACY.INVENTORY)
    },
    onError: (err) => {
      const detail = err?.response?.data?.detail
      setError(
        typeof detail === 'string'
          ? detail
          : 'Could not save the stock. Please check the details and try again.',
      )
    },
  })

  function pickMedicine(medicine) {
    setSelected(medicine)
    setSearchText('')
    setManufacturer(medicine.manufacturer ?? '')
    setSellingPrice(
      medicine.jan_aushadhi_mrp != null ? String(medicine.jan_aushadhi_mrp) : '',
    )
    setError('')
  }

  function clearMedicine() {
    setSelected(null)
    setError('')
  }

  function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (!kendraId) {
      setError(
        'Your account is not linked to a Kendra, so stock cannot be saved. ' +
          'Log in with a real pharmacy owner account (not the demo account).',
      )
      return
    }
    if (!selected) {
      setError('Select a medicine from the catalogue first.')
      return
    }
    if (!batchNumber.trim() || !expiryDate || !quantity || manufacturer.trim().length < 2) {
      setError('Batch number, expiry date, quantity and manufacturer are required.')
      return
    }
    if (!(Number(quantity) > 0) || !Number.isInteger(Number(quantity))) {
      setError('Quantity must be a whole number greater than zero.')
      return
    }
    if (new Date(expiryDate) <= new Date()) {
      setError('Expiry date must be in the future.')
      return
    }
    if (sellingPrice !== '' && !(Number(sellingPrice) > 0)) {
      setError('Selling price must be greater than zero (or leave it empty).')
      return
    }

    const payload = {
      pmbi_code: selected.pmbi_code,
      batch_number: batchNumber.trim(),
      expiry_date: new Date(expiryDate).toISOString(),
      quantity: Number(quantity),
      manufacturer: manufacturer.trim(),
      verification_status: verification,
    }
    if (sellingPrice !== '') payload.selling_price = Number(sellingPrice)

    restockMutation.mutate(payload)
  }

  return (
    <article aria-label="Add Medicine" className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={ROUTES.PHARMACY.INVENTORY}
          aria-label="Back to inventory"
          className="flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <HiOutlineArrowLeft size={16} aria-hidden="true" />
        </Link>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Add Medicine</h1>
          <p className="text-xs text-slate-500">
            Choose a medicine from the Jan Aushadhi catalogue and add a stock batch
          </p>
        </div>
      </div>

      {!kendraId && (
        <div
          role="status"
          className="flex items-start gap-2 px-4 py-3 mb-5 rounded-xl bg-warning-50 text-warning-700 text-xs"
        >
          <HiOutlineExclamationTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            This account is not linked to a Kendra, so you can search and fill the form
            but not save. Log in with a pharmacy owner account to add stock.
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* Step 1: choose the medicine */}
        <section className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-3">1. Select medicine</h2>

          {selected ? (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-success-100 bg-success-50 p-4">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                  <HiOutlineCheckCircle size={16} className="text-success-600 shrink-0" aria-hidden="true" />
                  {selected.brand_name}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">{selected.generic_name}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {selected.composition} · PMBI code {selected.pmbi_code}
                  {selected.pack_size ? ` · ${selected.pack_size}` : ''}
                </p>
                <p className="text-xs text-slate-500">
                  Catalogue price {formatPrice(selected.jan_aushadhi_mrp)}
                  {selected.category ? ` · ${selected.category}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={clearMedicine}
                className="text-xs font-semibold text-primary-700 hover:underline shrink-0"
              >
                Change
              </button>
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold text-slate-700" htmlFor="medicine-search">
                Search by brand, generic name, composition or PMBI code
              </label>
              <div className="relative">
                <HiOutlineMagnifyingGlass
                  size={16}
                  className="absolute left-3 top-1/2 translate-y-[-30%] text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="medicine-search"
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="e.g. Amlodipine, Paracetamol 500, Amlong"
                  autoComplete="off"
                  className={`${INPUT_CLASS} pl-9`}
                />
              </div>

              {debouncedSearch.length >= 2 && (
                <div className="mt-2">
                  {searchQuery.isFetching && (
                    <p className="text-xs text-slate-500 px-1 py-2">Searching…</p>
                  )}

                  {searchQuery.isError && (
                    <p className="text-xs text-danger-700 px-1 py-2">
                      Could not search the catalogue. Is the backend running?
                    </p>
                  )}

                  {!searchQuery.isFetching && !searchQuery.isError && results.length === 0 && (
                    <p className="text-xs text-slate-500 px-1 py-2">
                      No medicine found for “{debouncedSearch}”.
                    </p>
                  )}

                  {resolvedFrom && results.length > 0 && (
                    <p className="text-xs text-slate-500 px-1 pb-2">
                      No exact match for “{resolvedFrom.query}” — showing Jan Aushadhi
                      equivalents for {resolvedFrom.ingredients.join(' + ')}.
                    </p>
                  )}

                  {results.length > 0 && (
                    <ul
                      role="listbox"
                      aria-label="Matching medicines"
                      className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100"
                    >
                      {results.map((medicine) => (
                        <li key={medicine.id ?? medicine.pmbi_code}>
                          <button
                            type="button"
                            role="option"
                            aria-selected="false"
                            onClick={() => pickMedicine(medicine)}
                            className="w-full text-left px-3 py-2.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50"
                          >
                            <span className="block text-sm font-semibold text-slate-900">
                              {medicine.brand_name}
                            </span>
                            <span className="block text-xs text-slate-600">
                              {medicine.generic_name}
                            </span>
                            <span className="block text-[11px] text-slate-400">
                              PMBI {medicine.pmbi_code} · {formatPrice(medicine.jan_aushadhi_mrp)}
                              {medicine.pack_size ? ` · ${medicine.pack_size}` : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {searchQuery.data?.total > results.length && (
                    <p className="text-[11px] text-slate-400 px-1 pt-2">
                      Showing the first {results.length} of {searchQuery.data.total}. Type more
                      of the name or strength to narrow it down.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Step 2: batch details */}
        <section className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-3">2. Batch details</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-xs font-semibold text-slate-700">
              Batch number *
              <input
                type="text"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="e.g. MFG/2026/001"
                className={INPUT_CLASS}
              />
            </label>

            <label className="text-xs font-semibold text-slate-700">
              Expiry date *
              <input
                type="date"
                value={expiryDate}
                min={todayPlusDays(1)}
                onChange={(e) => setExpiryDate(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>

            <label className="text-xs font-semibold text-slate-700">
              Quantity (units) *
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 50"
                className={INPUT_CLASS}
              />
            </label>

            <label className="text-xs font-semibold text-slate-700">
              Manufacturer (this batch) *
              <input
                type="text"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                placeholder="e.g. Bureau of Pharma PSUs of India (BPPI)"
                className={INPUT_CLASS}
              />
            </label>

            <label className="text-xs font-semibold text-slate-700">
              Selling price per unit (₹)
              <input
                type="number"
                min="0"
                step="0.01"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                placeholder={selected ? String(selected.jan_aushadhi_mrp ?? '') : 'Catalogue price'}
                className={INPUT_CLASS}
              />
              <span className="block mt-1 text-[11px] font-normal text-slate-400">
                Leave empty to use the catalogue price.
              </span>
            </label>

            <label className="text-xs font-semibold text-slate-700">
              Source of this batch
              <select
                value={verification}
                onChange={(e) => setVerification(e.target.value)}
                className={INPUT_CLASS}
              >
                {VERIFICATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="block mt-1 text-[11px] font-normal text-slate-400">
                Used as the trust score when patients compare Kendras.
              </span>
            </label>
          </div>
        </section>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 px-4 py-3 rounded-xl bg-danger-50 text-danger-700 text-xs"
          >
            <HiOutlineExclamationTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pb-4">
          <Link
            to={ROUTES.PHARMACY.INVENTORY}
            className="px-5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            Cancel
          </Link>
          <Button type="submit" variant="primary" loading={restockMutation.isPending}>
            Save stock
          </Button>
        </div>
      </form>
    </article>
  )
}

export default AddMedicinePage