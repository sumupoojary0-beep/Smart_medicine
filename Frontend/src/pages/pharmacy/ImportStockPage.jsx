/**
 * Component: ImportStockPage
 *
 * Route: /pharmacy/inventory/import
 *
 * Add stock from a SUPPLIER BILL instead of typing every batch by hand.
 *
 *   1. Upload  the bill: photo (JPG/PNG), PDF, Excel or CSV
 *   2. Read    POST /kendras/:id/stock-import/preview
 *              the backend extracts the rows, matches them to the catalogue
 *              and returns them - NOTHING is saved yet
 *   3. Review  every row is editable: medicine, batch, expiry, quantity, price.
 *              Rows with problems are highlighted and block the Add button.
 *   4. Add     POST /kendras/:id/stock-import/confirm
 *              only the rows that are ticked are added to stock
 *
 * A bill read from a photo is never trusted blindly - the owner checks the
 * table against the paper bill before adding.
 */

import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  HiOutlineArrowLeft,
  HiOutlineArrowUpTray,
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle,
  HiOutlineMagnifyingGlass,
  HiOutlineDocumentText,
} from 'react-icons/hi2'

import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import { ROUTES } from '../../constants/routes'
import { useAuth } from '../../contexts/AuthContext'
import useDebounce from '../../hooks/useDebounce'
import kendraService from '../../services/kendraService'
import medicineService from '../../services/medicineService'

const FIELD =
  'h-9 px-2 rounded-lg border border-slate-200 bg-white text-sm outline-none ' +
  'focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20'

const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.xlsx,.xlsm,.csv'

const SOURCE_OPTIONS = [
  { value: 'distributor', label: 'Authorised distributor' },
  { value: 'verified', label: 'Verified (BPPI / PMBI supply)' },
  { value: 'unverified', label: 'Unverified' },
]

const LEVEL_BADGE = {
  high: { variant: 'success', label: 'Matched' },
  review: { variant: 'warning', label: 'Check match' },
  manual: { variant: 'info', label: 'You chose' },
  none: { variant: 'danger', label: 'Not found' },
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function errorText(error, fallback) {
  const detail = error?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((d) => d?.msg || String(d)).join(' | ')
  }
  if (!error?.response) {
    return 'The server could not be reached. Make sure the backend is running on port 8002.'
  }
  return fallback
}

function toEditable(row) {
  return {
    key: `${row.line_no}`,
    include: row.include,
    itemName: row.item_name,
    packSize: row.pack_size,
    candidates: row.candidates ?? [],
    pmbiCode: row.pmbi_code ?? '',
    level: row.match_level,
    batch: row.batch_number ?? '',
    expiry: row.expiry_date ?? '',
    qty: row.quantity != null ? String(row.quantity) : '',
    mrp: row.mrp,
    purchaseRate: row.purchase_rate,
    manufacturer: row.manufacturer ?? '',
    sellPrice: '',
    warnings: row.warnings ?? [],
  }
}

/** Problems that block a row from being added (mirrors the backend rules). */
function rowErrors(row) {
  const errors = []
  if (!row.pmbiCode) errors.push('Choose the medicine')
  if (!row.batch.trim()) errors.push('Batch number is missing')
  if (!row.expiry) errors.push('Expiry date is missing')
  else if (row.expiry < todayIso()) errors.push('Already expired')
  const qty = Number(row.qty)
  if (!Number.isInteger(qty) || qty < 1) errors.push('Quantity must be 1 or more')
  return errors
}

/** Medicine picker: the matcher's best guesses + a catalogue search. */
function MedicineCell({ row, onPick }) {
  const [searching, setSearching] = useState(false)
  const [text, setText] = useState('')
  const debounced = useDebounce(text.trim(), 350)

  const query = useQuery({
    queryKey: ['medicines', 'import-search', debounced],
    queryFn: async () =>
      (await medicineService.search({ q: debounced, page: 1, page_size: 6 })).data,
    enabled: searching && debounced.length >= 2,
  })
  const results = query.data?.results ?? []

  return (
    <div className="min-w-[230px]">
      <select
        aria-label={`Medicine for ${row.itemName}`}
        value={row.pmbiCode}
        onChange={(event) => {
          const picked = row.candidates.find((c) => c.pmbi_code === event.target.value)
          if (picked) onPick(picked, 'manual')
        }}
        className={`${FIELD} w-full`}
      >
        {!row.pmbiCode && <option value="">Choose medicine…</option>}
        {row.candidates.map((candidate) => (
          <option key={candidate.pmbi_code} value={candidate.pmbi_code}>
            {candidate.name}
            {candidate.pack_size ? ` · ${candidate.pack_size}` : ''}
            {candidate.score < 1 ? ` · ${Math.round(candidate.score * 100)}%` : ''}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => setSearching((value) => !value)}
        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 hover:underline"
      >
        <HiOutlineMagnifyingGlass size={12} aria-hidden="true" />
        {searching ? 'Close search' : 'Search catalogue'}
      </button>

      {searching && (
        <div className="mt-1">
          <input
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Brand, generic or PMBI code"
            aria-label="Search the catalogue"
            className={`${FIELD} w-full`}
          />
          {query.isFetching && <p className="text-[11px] text-slate-400 mt-1">Searching…</p>}
          {results.length > 0 && (
            <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              {results.map((medicine) => (
                <li key={medicine.pmbi_code}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(
                        {
                          pmbi_code: medicine.pmbi_code,
                          name: medicine.generic_name || medicine.brand_name,
                          pack_size: medicine.pack_size,
                          jan_aushadhi_mrp: medicine.jan_aushadhi_mrp,
                          score: 1,
                        },
                        'manual',
                      )
                      setSearching(false)
                      setText('')
                    }}
                    className="w-full text-left px-2 py-1.5 text-xs hover:bg-primary-50"
                  >
                    <span className="font-semibold text-slate-800">
                      {medicine.generic_name || medicine.brand_name}
                    </span>
                    <span className="text-slate-500">
                      {' '}· {medicine.pack_size ?? ''} · code {medicine.pmbi_code}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function ImportStockPage() {
  const queryClient = useQueryClient()
  const { currentUser } = useAuth()
  const kendraId = currentUser?.assignedKendraId ?? null
  const fileInput = useRef(null)

  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState(null)
  const [rows, setRows] = useState([])
  const [supplier, setSupplier] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [source, setSource] = useState('distributor')
  const [useBillMrp, setUseBillMrp] = useState(false)
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const [showDuplicateOption, setShowDuplicateOption] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const previewMutation = useMutation({
    mutationFn: async (selected) => (await kendraService.previewStockImport(kendraId, selected)).data,
    onSuccess: (data) => {
      setPreview(data)
      setRows(data.rows.map(toEditable))
      setSupplier(data.invoice?.supplier_name ?? '')
      setInvoiceNo(data.invoice?.invoice_no ?? '')
      setInvoiceDate(data.invoice?.invoice_date ?? '')
      setAllowDuplicate(false)
      setShowDuplicateOption(Boolean(data.duplicate_of))
      setError('')
    },
    onError: (err) => setError(errorText(err, 'The bill could not be read. Please try again.')),
  })

  const confirmMutation = useMutation({
    mutationFn: async (payload) => (await kendraService.confirmStockImport(kendraId, payload)).data,
    onSuccess: (data) => {
      setResult(data)
      setError('')
      queryClient.invalidateQueries({ queryKey: ['kendra'] })
    },
    onError: (err) => {
      if (err?.response?.status === 409) setShowDuplicateOption(true)
      setError(errorText(err, 'Could not add the stock. Please check the rows and try again.'))
    },
  })

  function chooseFile(selected) {
    if (!selected) return
    setFile(selected)
    setPreview(null)
    setRows([])
    setResult(null)
    setError('')
  }

  function readBill() {
    if (!file) return
    setError('')
    previewMutation.mutate(file)
  }

  function updateRow(key, changes) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)))
  }

  function pickMedicine(key, candidate, level) {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row
        const known = row.candidates.some((c) => c.pmbi_code === candidate.pmbi_code)
        return {
          ...row,
          pmbiCode: candidate.pmbi_code,
          level,
          include: true,
          candidates: known ? row.candidates : [candidate, ...row.candidates],
        }
      }),
    )
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setRows([])
    setResult(null)
    setError('')
    setSupplier('')
    setInvoiceNo('')
    setInvoiceDate('')
    setAllowDuplicate(false)
    setShowDuplicateOption(false)
    if (fileInput.current) fileInput.current.value = ''
  }

  const included = rows.filter((row) => row.include)
  const blocked = included.filter((row) => rowErrors(row).length > 0)
  const totalUnits = included.reduce((sum, row) => sum + (Number(row.qty) || 0), 0)

  function handleConfirm() {
    setError('')
    if (!kendraId) {
      setError(
        'Your account is not linked to a Kendra, so stock cannot be saved. ' +
          'Log in with a real pharmacy owner account (not the demo account).',
      )
      return
    }
    if (included.length === 0) {
      setError('Tick at least one row to add.')
      return
    }
    if (blocked.length > 0) {
      setError(`Fix the ${blocked.length} highlighted row(s) or untick them first.`)
      return
    }

    confirmMutation.mutate({
      rows: included.map((row) => {
        const payload = {
          pmbi_code: row.pmbiCode,
          batch_number: row.batch.trim(),
          expiry_date: row.expiry,
          quantity: Number(row.qty),
          item_name: row.itemName,
        }
        if (row.manufacturer.trim()) payload.manufacturer = row.manufacturer.trim()
        if (row.mrp != null) payload.mrp = row.mrp
        if (row.purchaseRate != null) payload.purchase_rate = row.purchaseRate
        if (row.sellPrice !== '' && Number(row.sellPrice) > 0) {
          payload.selling_price = Number(row.sellPrice)
        } else if (useBillMrp && row.mrp > 0) {
          payload.selling_price = row.mrp
        }
        return payload
      }),
      invoice_no: invoiceNo.trim() || null,
      invoice_date: invoiceDate || null,
      supplier_name: supplier.trim() || null,
      verification_status: source,
      source: preview?.source ?? null,
      file_name: file?.name ?? null,
      allow_duplicate: allowDuplicate,
    })
  }

  /* ---------------------------------------------------------------- success */
  if (result) {
    return (
      <article aria-label="Import stock" className="max-w-2xl mx-auto">
        <section className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
          <HiOutlineCheckCircle size={44} className="mx-auto text-success-600" aria-hidden="true" />
          <h1 className="text-xl font-extrabold text-slate-900 mt-3">Stock added</h1>
          <p className="text-sm text-slate-600 mt-2">
            {result.rows_imported} line{result.rows_imported === 1 ? '' : 's'} ·{' '}
            {result.medicines} medicine{result.medicines === 1 ? '' : 's'} ·{' '}
            {result.units_added} units added to your inventory.
          </p>
          {result.merged_into_existing_batches > 0 && (
            <p className="text-xs text-slate-500 mt-1">
              {result.merged_into_existing_batches} line(s) matched a batch you already had, so
              their quantity was added to it.
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            <Link to={ROUTES.PHARMACY.INVENTORY}>
              <Button variant="primary">View inventory</Button>
            </Link>
            <Link to={ROUTES.PHARMACY.INVENTORY_DASHBOARD}>
              <Button variant="outline">Inventory overview</Button>
            </Link>
            <Button variant="ghost" onClick={reset}>Import another bill</Button>
          </div>
        </section>
      </article>
    )
  }

  /* ------------------------------------------------------------------- page */
  return (
    <article aria-label="Import stock" className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={ROUTES.PHARMACY.INVENTORY_ADD}
          aria-label="Back to add medicine"
          className="flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <HiOutlineArrowLeft size={16} aria-hidden="true" />
        </Link>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Import from supplier bill</h1>
          <p className="text-xs text-slate-500">
            Upload the bill, check what was read, then add it to your stock in one go
          </p>
        </div>
      </div>

      {!kendraId && (
        <div role="status" className="flex items-start gap-2 px-4 py-3 mb-5 rounded-xl bg-warning-50 text-warning-700 text-xs">
          <HiOutlineExclamationTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            This account is not linked to a Kendra, so a bill cannot be read or saved.
            Log in with a pharmacy owner account.
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 px-4 py-3 mb-5 rounded-xl bg-danger-50 text-danger-700 text-sm">
          <HiOutlineExclamationTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* ---------------------------------------------------------- 1. upload */}
      <section className="bg-white rounded-2xl border border-slate-100 p-5 mb-5">
        <h2 className="text-sm font-bold text-slate-900 mb-3">1. Upload the supplier bill</h2>

        <label
          htmlFor="bill-file"
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            chooseFile(event.dataTransfer.files?.[0])
          }}
          className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors ${
            dragging ? 'border-primary-500 bg-primary-50' : 'border-slate-200 hover:bg-slate-50'
          }`}
        >
          {file ? (
            <>
              <HiOutlineDocumentText size={26} className="text-primary-600" aria-hidden="true" />
              <span className="text-sm font-semibold text-slate-900">{file.name}</span>
              <span className="text-xs text-slate-500">Click to choose a different file</span>
            </>
          ) : (
            <>
              <HiOutlineArrowUpTray size={26} className="text-slate-400" aria-hidden="true" />
              <span className="text-sm font-semibold text-slate-800">
                Drop the bill here, or click to choose a file
              </span>
              <span className="text-xs text-slate-500">
                Photo (JPG, PNG) · PDF · Excel (.xlsx) · CSV — up to 10 MB
              </span>
            </>
          )}
          <input
            ref={fileInput}
            id="bill-file"
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Button
            variant="primary"
            onClick={readBill}
            loading={previewMutation.isPending}
            disabled={!file || !kendraId}
          >
            {preview ? 'Read again' : 'Read bill'}
          </Button>
          <p className="text-xs text-slate-500">
            {previewMutation.isPending
              ? 'Reading the bill… a photo can take up to a minute on the first scan.'
              : 'Excel, CSV and PDF bills are read instantly. Photos use the OCR service (port 8001).'}
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- 2. review */}
      {preview && (
        <>
          <section className="bg-white rounded-2xl border border-slate-100 p-5 mb-5">
            <h2 className="text-sm font-bold text-slate-900 mb-3">2. Bill details</h2>

            {preview.duplicate_of && (
              <div role="alert" className="flex items-start gap-2 px-3 py-2 mb-4 rounded-xl bg-warning-50 text-warning-700 text-xs">
                <HiOutlineExclamationTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  Invoice {preview.duplicate_of.invoice_no} looks like it was already imported
                  {preview.duplicate_of.imported_at ? ` on ${preview.duplicate_of.imported_at.slice(0, 10)}` : ''}.
                  Adding it again would count the same medicines twice.
                </span>
              </div>
            )}

            {preview.ocr_used && (
              <div className="flex items-start gap-2 px-3 py-2 mb-4 rounded-xl bg-info-50 text-info-700 text-xs">
                <HiOutlineExclamationTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  This bill was read from a photo. Compare every batch number, expiry date and
                  quantity with the paper bill — OCR can mix up 0/O and 1/I.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <label className="text-xs font-semibold text-slate-700">
                Supplier
                <input
                  type="text"
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                  placeholder="e.g. Sri Distributors"
                  className={`${FIELD} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Invoice no.
                <input
                  type="text"
                  value={invoiceNo}
                  onChange={(event) => setInvoiceNo(event.target.value)}
                  placeholder="Used to stop the same bill being added twice"
                  className={`${FIELD} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Invoice date
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(event) => setInvoiceDate(event.target.value)}
                  className={`${FIELD} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Stock source
                <select value={source} onChange={(event) => setSource(event.target.value)} className={`${FIELD} mt-1 w-full`}>
                  {SOURCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {(showDuplicateOption || preview.duplicate_of) && (
              <label className="mt-4 flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={allowDuplicate}
                  onChange={(event) => setAllowDuplicate(event.target.checked)}
                />
                Import again anyway (this is a second delivery on the same invoice number)
              </label>
            )}
          </section>

          <section className="bg-white rounded-2xl border border-slate-100 p-5 mb-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-bold text-slate-900">3. Check the medicines</h2>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="neutral" size="sm">{preview.summary.rows} lines read</Badge>
                <Badge variant="success" size="sm">{preview.summary.ready} ready</Badge>
                {preview.summary.review > 0 && <Badge variant="warning" size="sm">{preview.summary.review} to check</Badge>}
                {preview.summary.unmatched > 0 && <Badge variant="danger" size="sm">{preview.summary.unmatched} not found</Badge>}
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
                <p className="font-semibold text-slate-800">No medicine lines were found in this bill.</p>
                <p className="mt-1 text-xs">
                  {preview.header_found
                    ? 'The table header was found but no rows could be read.'
                    : 'The table header (Batch / Exp / Qty …) was not found.'}{' '}
                  Try a sharper, straighter photo, or upload the Excel / PDF version. You can also add
                  medicines one by one on the{' '}
                  <Link className="text-primary-700 underline" to={ROUTES.PHARMACY.INVENTORY_ADD}>Add Medicine</Link> page.
                </p>
              </div>
            ) : (
              <>
                <label className="mb-3 flex items-center gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={useBillMrp} onChange={(event) => setUseBillMrp(event.target.checked)} />
                  Use the MRP printed on the bill as my selling price (otherwise the catalogue price is used)
                </label>

                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="min-w-[1100px] w-full text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left w-10">Add</th>
                        <th className="px-3 py-2 text-left">On the bill</th>
                        <th className="px-3 py-2 text-left">Matched medicine</th>
                        <th className="px-3 py-2 text-left">Batch</th>
                        <th className="px-3 py-2 text-left">Expiry</th>
                        <th className="px-3 py-2 text-left w-20">Qty</th>
                        <th className="px-3 py-2 text-right">Bill MRP</th>
                        <th className="px-3 py-2 text-left w-28">Sell at</th>
                        <th className="px-3 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const errors = rowErrors(row)
                        const badge = LEVEL_BADGE[row.level] ?? LEVEL_BADGE.none
                        const tint = !row.include
                          ? 'bg-slate-50/70 opacity-60'
                          : errors.length
                            ? 'bg-danger-50/50'
                            : row.level === 'review'
                              ? 'bg-warning-50/50'
                              : ''
                        return (
                          <tr key={row.key} className={`border-t border-slate-100 align-top ${tint}`}>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                aria-label={`Add ${row.itemName}`}
                                checked={row.include}
                                onChange={(event) => updateRow(row.key, { include: event.target.checked })}
                              />
                            </td>
                            <td className="px-3 py-2 max-w-[220px]">
                              <p className="text-xs font-semibold text-slate-800 break-words">{row.itemName}</p>
                              {row.packSize && <p className="text-[11px] text-slate-500">{row.packSize}</p>}
                            </td>
                            <td className="px-3 py-2">
                              <MedicineCell row={row} onPick={(candidate, level) => pickMedicine(row.key, candidate, level)} />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                aria-label={`Batch for ${row.itemName}`}
                                value={row.batch}
                                onChange={(event) => updateRow(row.key, { batch: event.target.value.toUpperCase() })}
                                className={`${FIELD} w-32`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="date"
                                aria-label={`Expiry for ${row.itemName}`}
                                value={row.expiry}
                                onChange={(event) => updateRow(row.key, { expiry: event.target.value })}
                                className={`${FIELD} w-36`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                inputMode="numeric"
                                aria-label={`Quantity for ${row.itemName}`}
                                value={row.qty}
                                onChange={(event) => updateRow(row.key, { qty: event.target.value.replace(/\D/g, '') })}
                                className={`${FIELD} w-16`}
                              />
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-slate-600 whitespace-nowrap">
                              {row.mrp != null ? `₹${Number(row.mrp).toFixed(2)}` : '—'}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                inputMode="decimal"
                                aria-label={`Selling price for ${row.itemName}`}
                                value={row.sellPrice}
                                placeholder="auto"
                                onChange={(event) => updateRow(row.key, { sellPrice: event.target.value.replace(/[^\d.]/g, '') })}
                                className={`${FIELD} w-24`}
                              />
                            </td>
                            <td className="px-3 py-2 text-xs min-w-[170px]">
                              <Badge variant={errors.length && row.include ? 'danger' : badge.variant} size="sm">
                                {errors.length && row.include ? 'Fix this row' : badge.label}
                              </Badge>
                              {row.include && errors.map((message) => (
                                <p key={message} className="mt-1 text-danger-700">{message}</p>
                              ))}
                              {row.include && !errors.length && row.warnings.map((message) => (
                                <p key={message} className="mt-1 text-warning-700">{message}</p>
                              ))}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {preview.unparsed_lines?.length > 0 && (
              <details className="mt-4 text-xs text-slate-600">
                <summary className="cursor-pointer font-semibold text-slate-700">
                  {preview.unparsed_lines.length} line(s) on the bill could not be understood
                </summary>
                <ul className="mt-2 space-y-1 list-disc pl-5">
                  {preview.unparsed_lines.map((line) => <li key={line}>{line}</li>)}
                </ul>
                <p className="mt-1">Add these by hand on the Add Medicine page if they are medicines.</p>
              </details>
            )}
          </section>

          {rows.length > 0 && (
            <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-5 py-3 shadow-lg backdrop-blur">
              <p className="text-sm text-slate-700">
                <span className="font-bold text-slate-900">{included.length}</span> line{included.length === 1 ? '' : 's'} ·{' '}
                <span className="font-bold text-slate-900">{totalUnits}</span> units will be added
                {blocked.length > 0 && (
                  <span className="ml-2 text-danger-700 text-xs font-semibold">
                    {blocked.length} row(s) need fixing
                  </span>
                )}
              </p>
              <Button
                variant="primary"
                onClick={handleConfirm}
                loading={confirmMutation.isPending}
                disabled={included.length === 0 || blocked.length > 0 || !kendraId}
              >
                Add to stock
              </Button>
            </div>
          )}
        </>
      )}
    </article>
  )
}

export default ImportStockPage