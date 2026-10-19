/**
 * Component: BillingPage
 *
 * Description:
 *   Point-of-sale billing screen for the pharmacy owner. Search the
 *   catalogue, build a cart, add patient / doctor details, discount, GST and
 *   payment method, and submit as one bill. The backend deducts stock
 *   FIFO (oldest non-expired batch first), saves the bill with a sequential
 *   bill number and returns a GST invoice (one row per batch used).
 *
 *   GST is INCLUDED in the MRP: the invoice shows how much of the amount is
 *   tax (CGST + SGST), it is not added on top.
 *
 * Backend:
 *   GET  /api/v1/medicines/search?q=…   — find a medicine to add
 *   GET  /api/v1/kendras/:id            — stock levels (shown next to results)
 *   POST /api/v1/kendras/:id/bill
 *        { items:[{pmbi_code, quantity}], customer_name, customer_phone,
 *          doctor_name, discount, gst_percentage, payment_method }
 *   GET/PUT /api/v1/kendras/:id/billing-details — GSTIN, D.L. no., bill numbering
 */

import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  HiOutlineMagnifyingGlass, HiOutlineTrash, HiOutlinePlus,
  HiOutlineExclamationTriangle, HiOutlineCheckCircle, HiOutlineReceiptPercent,
  HiOutlinePrinter,
} from 'react-icons/hi2'
import Button from '../../components/ui/Button'
import BillReceipt from '../../components/billing/BillReceipt'
import { ROUTES } from '../../constants/routes'
import { useAuth } from '../../contexts/AuthContext'
import useDebounce from '../../hooks/useDebounce'
import kendraService from '../../services/kendraService'
import medicineService from '../../services/medicineService'
import {
  PAYMENT_METHODS, GST_OPTIONS, DEFAULT_GST, computeTotals, formatINR, printBill,
} from '../../utils/billing'

const FIELD =
  'w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm outline-none ' +
  'focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20'

// GSTIN, drug licence number and bill-book numbering: printed on every invoice.
function ShopDetailsCard({ kendraId, details }) {
  const queryClient = useQueryClient()
  const [gstin, setGstin] = useState(details.gstin ?? '')
  const [licence, setLicence] = useState(details.drug_license_no ?? '')
  const [nextNumber, setNextNumber] = useState('')
  const [message, setMessage] = useState({ kind: '', text: '' })

  const save = useMutation({
    mutationFn: (payload) => kendraService.updateBillingDetails(kendraId, payload),
    onSuccess: () => {
      setNextNumber('')
      setMessage({ kind: 'ok', text: 'Saved. New bills will print these details.' })
      queryClient.invalidateQueries({ queryKey: ['kendra', kendraId, 'billing-details'] })
    },
    onError: (err) => {
      const detail = err?.response?.data?.detail
      setMessage({
        kind: 'error',
        text: Array.isArray(detail)
          ? detail.map((d) => d.msg?.replace(/^Value error, /, '')).join(' ')
          : (detail ?? 'Could not save. Please try again.'),
      })
    },
  })

  function handleSave(e) {
    e.preventDefault()
    setMessage({ kind: '', text: '' })
    save.mutate({
      gstin: gstin.trim() || null,
      drug_license_no: licence.trim() || null,
      ...(nextNumber ? { next_bill_number: Number(nextNumber) } : {}),
    })
  }

  return (
    <details className="bg-white rounded-2xl border border-slate-100 shadow-sm group" open={!details.gstin}>
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-800 flex items-center justify-between">
        <span>Shop details on the invoice</span>
        <span className={`text-xs font-normal ${details.gstin ? 'text-success-700' : 'text-warning-700'}`}>
          {details.gstin ? `GSTIN ${details.gstin}` : 'GSTIN not set'}
        </span>
      </summary>
      <form onSubmit={handleSave} className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-slate-700">
          GSTIN
          <input type="text" value={gstin} maxLength={15} placeholder="29DPSPS0749G1Z5"
            onChange={(e) => setGstin(e.target.value.toUpperCase())} className={`${FIELD} mt-1 font-mono`} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Drug licence no. (D.L.NO.)
          <input type="text" value={licence} maxLength={120} placeholder="KA-UD1-264715 / KA-UD1-264716"
            onChange={(e) => setLicence(e.target.value)} className={`${FIELD} mt-1`} />
        </label>
        <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
          Next bill number <span className="font-normal text-slate-400">
            (optional — to continue your paper bill book. Last used: {details.last_bill_number || 'none yet'})
          </span>
          <input type="number" min="1" value={nextNumber} placeholder="e.g. 27918"
            onChange={(e) => setNextNumber(e.target.value)} className={`${FIELD} mt-1`} />
        </label>
        {message.text && (
          <p role={message.kind === 'error' ? 'alert' : 'status'}
             className={`sm:col-span-2 text-xs ${message.kind === 'error' ? 'text-danger-700' : 'text-success-700'}`}>
            {message.text}
          </p>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" variant="outline" loading={save.isPending}>Save shop details</Button>
        </div>
      </form>
    </details>
  )
}

function BillingPage() {
  const { currentUser } = useAuth()
  const queryClient = useQueryClient()
  const kendraId = currentUser?.assignedKendraId ?? null

  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([]) // [{ pmbi_code, name, price, quantity }]
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [doctorName, setDoctorName] = useState('')
  const [discount, setDiscount] = useState('')
  const [gst, setGst] = useState(DEFAULT_GST)
  const [payment, setPayment] = useState('cash')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)

  const debouncedSearch = useDebounce(search.trim(), 300)

  // Searches the whole catalogue on the server (not just the first 200 rows).
  const searchQuery = useQuery({
    queryKey: ['medicines', 'billing-search', debouncedSearch],
    enabled: debouncedSearch.length >= 2,
    queryFn: async () =>
      (await medicineService.search({ q: debouncedSearch, page: 1, page_size: 8 })).data,
  })

  const kendraQuery = useQuery({
    queryKey: ['kendra', kendraId],
    enabled: Boolean(kendraId),
    queryFn: async () => (await kendraService.getById(kendraId)).data,
  })

  const detailsQuery = useQuery({
    queryKey: ['kendra', kendraId, 'billing-details'],
    enabled: Boolean(kendraId),
    queryFn: async () => (await kendraService.getBillingDetails(kendraId)).data,
  })

  const stockByCode = useMemo(() => {
    const map = {}
    for (const s of kendraQuery.data?.stock ?? []) map[s.pmbi_code] = s.total_qty
    return map
  }, [kendraQuery.data])

  const searchResults = debouncedSearch.length >= 2 ? (searchQuery.data?.results ?? []) : []

  const billMutation = useMutation({
    mutationFn: (payload) => kendraService.generateBill(kendraId, payload),
    onSuccess: (res) => {
      setReceipt(res.data)
      setCart([])
      setCustomerName(''); setCustomerPhone(''); setDoctorName('')
      setDiscount(''); setGst(DEFAULT_GST); setPayment('cash')
      setError('')
      // refreshes stock, the dashboard and bill history in one go
      queryClient.invalidateQueries({ queryKey: ['kendra', kendraId] })
    },
    onError: (err) => {
      setError(err?.response?.data?.detail ?? 'Billing failed. Please try again.')
    },
  })

  function addToCart(medicine) {
    setSearch('')
    setError('')
    setCart((prev) => {
      const existing = prev.find((c) => c.pmbi_code === medicine.pmbi_code)
      if (existing) {
        return prev.map((c) =>
          c.pmbi_code === medicine.pmbi_code ? { ...c, quantity: c.quantity + 1 } : c,
        )
      }
      return [...prev, {
        pmbi_code: medicine.pmbi_code,
        name: medicine.brand_name,
        price: Number(medicine.jan_aushadhi_mrp),
        quantity: 1,
      }]
    })
  }

  // Lets the field be emptied while typing; it snaps back to 1 on blur.
  function updateQuantity(pmbiCode, raw) {
    const qty = raw === '' ? '' : Math.max(1, Math.floor(Number(raw)) || 1)
    setCart((prev) => prev.map((c) => (c.pmbi_code === pmbiCode ? { ...c, quantity: qty } : c)))
  }

  function normaliseQuantity(pmbiCode) {
    setCart((prev) => prev.map((c) => (
      c.pmbi_code === pmbiCode && c.quantity === '' ? { ...c, quantity: 1 } : c
    )))
  }

  function removeFromCart(pmbiCode) {
    setCart((prev) => prev.filter((c) => c.pmbi_code !== pmbiCode))
  }

  const totals = computeTotals(
    cart.map((c) => ({ ...c, quantity: Number(c.quantity) || 0 })),
    discount,
    gst,
  )

  function handleGenerateBill() {
    setError('')
    if (cart.length === 0) {
      setError('Add at least one medicine to the cart.')
      return
    }
    if (totals.discountTooHigh) {
      setError('Discount cannot be more than the bill total.')
      return
    }
    const lines = cart.map((c) => ({ ...c, quantity: Math.max(1, Number(c.quantity) || 1) }))
    const over = lines.find((c) => c.quantity > (stockByCode[c.pmbi_code] ?? 0))
    if (over) {
      setError(`Only ${stockByCode[over.pmbi_code] ?? 0} units of ${over.name} are in stock.`)
      return
    }
    billMutation.mutate({
      items: lines.map((c) => ({ pmbi_code: c.pmbi_code, quantity: c.quantity })),
      customer_name: customerName.trim() || null,
      customer_phone: customerPhone.trim() || null,
      doctor_name: doctorName.trim() || null,
      discount: totals.discount,
      gst_percentage: Number(gst),
      payment_method: payment,
    })
  }

  if (!kendraId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
        <HiOutlineExclamationTriangle size={28} className="text-warning-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-700">No Kendra assigned to your account yet.</p>
        <p className="text-xs text-slate-500 max-w-sm">
          An admin needs to link your account to a Jan Aushadhi Kendra before you can generate bills.
        </p>
      </div>
    )
  }

  // ── Receipt view, shown after a successful bill ────────────────────────
  if (receipt) {
    return (
      <article className="max-w-3xl mx-auto flex flex-col gap-4">
        <div className="flex items-center gap-2 text-success-700">
          <HiOutlineCheckCircle size={22} aria-hidden="true" />
          <h1 className="text-lg font-extrabold">Bill Generated</h1>
        </div>

        <BillReceipt bill={receipt} />

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setReceipt(null)}>
            Generate Another Bill
          </Button>
          <Button
            variant="outline"
            leftIcon={<HiOutlinePrinter size={16} aria-hidden="true" />}
            onClick={() => printBill(receipt)}
          >
            Print
          </Button>
          <Link
            to={ROUTES.PHARMACY.BILL_HISTORY}
            className="inline-flex items-center text-sm font-medium text-primary-600 hover:underline px-2"
          >
            View bill history
          </Link>
        </div>
      </article>
    )
  }

  // ── Cart / billing entry view ───────────────────────────────────────────
  return (
    <article aria-label="Billing" className="flex flex-col gap-5 max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <HiOutlineReceiptPercent size={22} className="text-primary-600" aria-hidden="true" />
            Billing
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Stock is deducted oldest-expiry-first. Expired batches are never sold.
          </p>
        </div>
        <Link
          to={ROUTES.PHARMACY.BILL_HISTORY}
          className="text-xs font-semibold text-primary-600 hover:underline whitespace-nowrap pt-1"
        >
          Bill history →
        </Link>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 px-3 py-2 rounded-lg bg-danger-50 text-danger-700 text-xs">
          <HiOutlineExclamationTriangle size={14} aria-hidden="true" /> {error}
        </div>
      )}

      {/* Medicine search / add */}
      <div className="relative">
        <HiOutlineMagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search any medicine by brand, generic name or code…"
          aria-label="Search medicine to bill"
          className={`${FIELD} pl-9`}
        />
        {searchResults.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden" role="listbox" aria-label="Matching medicines">
            {searchResults.map((m) => {
              const inStock = stockByCode[m.pmbi_code] ?? 0
              return (
                <li key={m.pmbi_code} role="option" aria-selected="false" aria-disabled={inStock <= 0}>
                  <button
                    type="button"
                    disabled={inStock <= 0}
                    onClick={() => addToCart(m)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{m.brand_name}</p>
                      <p className="text-xs text-slate-500">
                        {m.pmbi_code} · {formatINR(m.jan_aushadhi_mrp)} ·{' '}
                        {inStock > 0 ? `${inStock} in stock` : 'Not in stock here'}
                      </p>
                    </div>
                    <HiOutlinePlus size={16} className="text-primary-500" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {debouncedSearch.length >= 2 && !searchQuery.isFetching && searchResults.length === 0 && search.trim() === debouncedSearch && (
          <p className="absolute z-10 mt-1 w-full bg-white rounded-xl border border-slate-200 shadow-lg px-4 py-3 text-xs text-slate-500">
            No medicine found for “{debouncedSearch}”.
          </p>
        )}
      </div>

      {/* Cart */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {cart.length === 0 ? (
          <p className="text-center py-10 text-sm text-slate-400">Cart is empty. Search above to add medicines.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {cart.map((item) => (
              <div key={item.pmbi_code} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{item.name}</p>
                  <p className="text-xs text-slate-500">
                    {formatINR(item.price)} each · {stockByCode[item.pmbi_code] ?? 0} in stock
                  </p>
                </div>
                <input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) => updateQuantity(item.pmbi_code, e.target.value)}
                  onBlur={() => normaliseQuantity(item.pmbi_code)}
                  aria-label={`Quantity for ${item.name}`}
                  className="w-16 h-9 px-2 rounded-lg border border-slate-200 text-sm text-center outline-none focus:border-primary-500"
                />
                <p className="w-24 text-right text-sm font-bold text-slate-900">
                  {formatINR(item.price * (Number(item.quantity) || 0))}
                </p>
                <button
                  type="button"
                  onClick={() => removeFromCart(item.pmbi_code)}
                  aria-label={`Remove ${item.name}`}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-danger-500 hover:bg-danger-50 transition-colors"
                >
                  <HiOutlineTrash size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Customer + payment details */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-slate-700">
          Patient name <span className="font-normal text-slate-400">(optional)</span>
          <input type="text" value={customerName} maxLength={100}
            onChange={(e) => setCustomerName(e.target.value)} className={`${FIELD} mt-1`} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Patient phone <span className="font-normal text-slate-400">(optional)</span>
          <input type="tel" value={customerPhone} maxLength={20}
            onChange={(e) => setCustomerPhone(e.target.value)} className={`${FIELD} mt-1`} />
        </label>
        <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
          Doctor name <span className="font-normal text-slate-400">(optional, printed as “Dr:”)</span>
          <input type="text" value={doctorName} maxLength={100}
            onChange={(e) => setDoctorName(e.target.value)} className={`${FIELD} mt-1`} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Discount (₹)
          <input type="number" min="0" step="0.01" value={discount} placeholder="0"
            onChange={(e) => setDiscount(e.target.value)} className={`${FIELD} mt-1`} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          GST rate <span className="font-normal text-slate-400">(already inside the MRP)</span>
          <select value={gst} onChange={(e) => setGst(Number(e.target.value))} className={`${FIELD} mt-1`}>
            {GST_OPTIONS.map((g) => (
              <option key={g} value={g}>{g === 0 ? 'No GST' : `${g}%`}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
          Payment method
          <select value={payment} onChange={(e) => setPayment(e.target.value)} className={`${FIELD} mt-1`}>
            {PAYMENT_METHODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Totals — GST is inside the MRP, so it is split out, not added */}
      {cart.length > 0 && (
        <dl className="bg-slate-50 rounded-2xl border border-slate-100 px-4 py-3 flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>Total (MRP)</dt><dd>{formatINR(totals.subtotal)}</dd>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between text-slate-600">
              <dt>Discount</dt><dd>− {formatINR(totals.discount)}</dd>
            </div>
          )}
          {Number(gst) > 0 && (
            <>
              <div className="flex justify-between text-slate-500 text-xs">
                <dt>Taxable value</dt><dd>{formatINR(totals.taxable)}</dd>
              </div>
              <div className="flex justify-between text-slate-500 text-xs">
                <dt>CGST {Number(gst) / 2}%</dt><dd>{formatINR(totals.cgst)}</dd>
              </div>
              <div className="flex justify-between text-slate-500 text-xs">
                <dt>SGST {Number(gst) / 2}%</dt><dd>{formatINR(totals.sgst)}</dd>
              </div>
            </>
          )}
          {totals.roundOff !== 0 && (
            <div className="flex justify-between text-slate-500 text-xs">
              <dt>Round off</dt><dd>{totals.roundOff > 0 ? '+' : '−'} {formatINR(Math.abs(totals.roundOff))}</dd>
            </div>
          )}
          <div className="flex justify-between items-center pt-1.5 border-t border-slate-200">
            <dt className="font-bold text-slate-900">Bill amount</dt>
            <dd className="text-lg font-extrabold text-primary-600" data-testid="bill-total">{formatINR(totals.total)}</dd>
          </div>
        </dl>
      )}

      {detailsQuery.data && <ShopDetailsCard kendraId={kendraId} details={detailsQuery.data} />}

      <Button
        variant="primary"
        onClick={handleGenerateBill}
        disabled={cart.length === 0 || billMutation.isPending}
      >
        {billMutation.isPending ? 'Generating…' : 'Generate Bill'}
      </Button>
    </article>
  )
}

export default BillingPage