/**
 * Component: BillHistoryPage
 *
 * Description:
 *   Every bill generated at the owner's Kendra, newest first, with search
 *   (bill number / customer name / phone), payment and date filters, paging,
 *   and a detail dialog with a print button.
 *
 * Backend:
 *   GET /api/v1/kendras/:id/bills
 *       ?page&page_size&search&payment_method&date_from&date_to
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  HiOutlineMagnifyingGlass, HiOutlineExclamationTriangle, HiOutlineEye,
  HiOutlinePrinter, HiOutlineReceiptPercent,
} from 'react-icons/hi2'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Modal from '../../components/dialogs/Modal'
import BillReceipt from '../../components/billing/BillReceipt'
import { ROUTES } from '../../constants/routes'
import { useAuth } from '../../contexts/AuthContext'
import useDebounce from '../../hooks/useDebounce'
import kendraService from '../../services/kendraService'
import { PAYMENT_METHODS, formatINR, paymentLabel, printBill } from '../../utils/billing'

const PAGE_SIZE = 10
const FIELD =
  'h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm outline-none ' +
  'focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20'

const PAYMENT_BADGE = { cash: 'success', upi: 'info', card: 'primary' }

function BillHistoryPage() {
  const { currentUser } = useAuth()
  const kendraId = currentUser?.assignedKendraId ?? null

  const [search, setSearch] = useState('')
  const [payment, setPayment] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)

  const debouncedSearch = useDebounce(search.trim(), 350)

  const params = {
    page,
    page_size: PAGE_SIZE,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(payment && { payment_method: payment }),
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
  }

  const query = useQuery({
    queryKey: ['kendra', kendraId, 'bills', params],
    enabled: Boolean(kendraId),
    placeholderData: keepPreviousData,
    queryFn: async () => (await kendraService.getBills(kendraId, params)).data,
  })

  const filtersActive = Boolean(search || payment || dateFrom || dateTo)
  const dateRangeInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo)

  function change(setter) {
    return (e) => { setter(e.target.value); setPage(1) }
  }

  function clearFilters() {
    setSearch(''); setPayment(''); setDateFrom(''); setDateTo(''); setPage(1)
  }

  if (!kendraId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
        <HiOutlineExclamationTriangle size={28} className="text-warning-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-700">No Kendra assigned to your account yet.</p>
        <p className="text-xs text-slate-500 max-w-sm">
          An admin needs to link your account to a Jan Aushadhi Kendra before bills can be shown.
        </p>
      </div>
    )
  }

  const data = query.data
  const totalPages = data ? Math.max(Math.ceil(data.total / PAGE_SIZE), 1) : 1

  return (
    <article aria-label="Bill history" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <HiOutlineReceiptPercent size={22} className="text-primary-600" aria-hidden="true" />
            Bill History
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">All bills generated at your Kendra, newest first.</p>
        </div>
        <Link to={ROUTES.PHARMACY.BILLING}>
          <Button size="sm">New bill</Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <HiOutlineMagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
          <input type="search" value={search} onChange={change(setSearch)}
            placeholder="Bill number, patient name or phone"
            aria-label="Search bills" className={`${FIELD} w-full pl-9`} />
        </div>
        <label className="text-xs font-semibold text-slate-700 flex flex-col gap-1">
          Payment
          <select value={payment} onChange={change(setPayment)} className={FIELD}>
            <option value="">All</option>
            {PAYMENT_METHODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700 flex flex-col gap-1">
          From
          <input type="date" value={dateFrom} onChange={change(setDateFrom)} className={FIELD} />
        </label>
        <label className="text-xs font-semibold text-slate-700 flex flex-col gap-1">
          To
          <input type="date" value={dateTo} onChange={change(setDateTo)} className={FIELD} />
        </label>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
        )}
        {dateRangeInvalid && (
          <p role="alert" className="basis-full text-xs text-danger-700">
            “From” date must be on or before the “To” date.
          </p>
        )}
      </div>

      {query.isError ? (
        <div className="flex flex-col items-center py-12 gap-3 text-center">
          <p role="alert" className="text-sm text-danger-700">
            {query.error?.response?.data?.detail ?? 'Could not load bills.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>Try again</Button>
        </div>
      ) : query.isLoading ? (
        <p className="py-12 text-center text-sm text-slate-400" role="status">Loading bills…</p>
      ) : (
        <>
          <p className="text-xs text-slate-500" data-testid="summary">
            <span className="font-semibold text-slate-700">{data.summary.bills}</span> bill{data.summary.bills === 1 ? '' : 's'}
            {' · '}
            <span className="font-semibold text-slate-700">{formatINR(data.summary.revenue)}</span> total
            {filtersActive && ' (matching your filters)'}
          </p>

          {data.results.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm py-14 text-center text-sm text-slate-400">
              {filtersActive ? 'No bills match these filters.' : 'No bills yet. Generate your first bill from the Billing page.'}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-3 font-semibold">Bill</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Patient</th>
                    <th className="px-4 py-3 font-semibold text-right">Units</th>
                    <th className="px-4 py-3 font-semibold">Payment</th>
                    <th className="px-4 py-3 font-semibold text-right">Total</th>
                    <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.results.map((b) => (
                    <tr key={b.bill_id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">#{b.bill_number}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(b.billed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {b.customer_name || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {b.items.reduce((n, i) => n + i.quantity, 0)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={PAYMENT_BADGE[b.payment_method] ?? 'neutral'} size="sm">{paymentLabel(b.payment_method)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">{formatINR(b.total_amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => setSelected(b)}
                          aria-label={`View bill ${b.bill_number}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50">
                          <HiOutlineEye size={16} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <nav aria-label="Pagination" className="flex items-center justify-between">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </nav>
          )}
        </>
      )}

      <Modal isOpen={Boolean(selected)} onClose={() => setSelected(null)} title="Bill details" size="xl"
        footer={selected && (
          <Button variant="outline" size="sm"
            leftIcon={<HiOutlinePrinter size={14} aria-hidden="true" />}
            onClick={() => printBill(selected)}>
            Print
          </Button>
        )}>
        {selected && <BillReceipt bill={selected} />}
      </Modal>
    </article>
  )
}

export default BillHistoryPage