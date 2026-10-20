/**
 * Component: AdminMedicines
 *
 * Description: Real medicine catalogue management (the Jan Aushadhi / PMBI list).
 *              Search, filter, add, edit, hide from patient search, show again.
 *
 * Backend: GET/POST /admin/medicines, PUT /admin/medicines/:code,
 *          POST /admin/medicines/:code/hide | show
 *
 * Notes: the PMBI code cannot be changed after creating a medicine, and the
 *        saving % is worked out from the two prices.
 */

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HiOutlinePlus, HiOutlinePencil, HiOutlineEye, HiOutlineEyeSlash } from 'react-icons/hi2'
import { MdMedication } from 'react-icons/md'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Modal from '../../components/dialogs/Modal'
import useDebounce from '../../hooks/useDebounce'
import adminManageService from '../../services/adminManageService'
import { formatINR } from '../../utils/billing'

const PAGE_SIZE = 15
const EMPTY = {
  pmbi_code: '', brand_name: '', generic_name: '', composition: '', category: '',
  jan_aushadhi_mrp: '', branded_avg_mrp: '', pack_size: '', manufacturer: 'Bureau of Pharma PSUs of India (BPPI)',
}

function validate(f) {
  const e = {}
  if (!f.pmbi_code.trim()) e.pmbi_code = 'Required.'
  if (f.brand_name.trim().length < 2) e.brand_name = 'Enter the medicine name.'
  if (f.generic_name.trim().length < 2) e.generic_name = 'Enter the generic name.'
  if (f.composition.trim().length < 2) e.composition = 'Enter the composition.'
  if (f.category.trim().length < 2) e.category = 'Enter a category.'
  if (f.jan_aushadhi_mrp === '' || Number(f.jan_aushadhi_mrp) < 0) e.jan_aushadhi_mrp = 'Enter the Jan Aushadhi price.'
  if (f.branded_avg_mrp !== '' && Number(f.branded_avg_mrp) < 0) e.branded_avg_mrp = 'Cannot be negative.'
  return e
}

function Field({ label, error, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {error && <span role="alert" className="text-xs text-danger-600">{error}</span>}
    </label>
  )
}

function MedicineForm({ initial, editing, categories, onSubmit, onClose, saving, serverError }) {
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const set = (k) => (ev) => { setForm((f) => ({ ...f, [k]: ev.target.value })); setErrors((e) => ({ ...e, [k]: undefined })) }

  function submit(ev) {
    ev.preventDefault()
    const found = validate(form)
    setErrors(found)
    if (Object.keys(found).length) return
    onSubmit({
      pmbi_code: form.pmbi_code.trim(), brand_name: form.brand_name.trim(), generic_name: form.generic_name.trim(),
      composition: form.composition.trim(), category: form.category.trim(),
      jan_aushadhi_mrp: Number(form.jan_aushadhi_mrp), branded_avg_mrp: form.branded_avg_mrp === '' ? 0 : Number(form.branded_avg_mrp),
      pack_size: form.pack_size.trim(), manufacturer: form.manufacturer.trim() || EMPTY.manufacturer,
    })
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {serverError && <p role="alert" className="text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded-lg p-2.5">{serverError}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="PMBI code *" error={errors.pmbi_code}>
          <input className="input-base" value={form.pmbi_code} onChange={set('pmbi_code')} disabled={editing} />
        </Field>
        <Field label="Category *" error={errors.category}>
          <input className="input-base" list="med-categories" value={form.category} onChange={set('category')} />
          <datalist id="med-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Medicine name *" error={errors.brand_name} className="sm:col-span-2">
          <input className="input-base" value={form.brand_name} onChange={set('brand_name')} placeholder="Paracetamol Tablets IP 500 mg" />
        </Field>
        <Field label="Generic name *" error={errors.generic_name}>
          <input className="input-base" value={form.generic_name} onChange={set('generic_name')} />
        </Field>
        <Field label="Composition *" error={errors.composition}>
          <input className="input-base" value={form.composition} onChange={set('composition')} />
        </Field>
        <Field label="Jan Aushadhi price (₹) *" error={errors.jan_aushadhi_mrp}>
          <input className="input-base" inputMode="decimal" value={form.jan_aushadhi_mrp} onChange={set('jan_aushadhi_mrp')} />
        </Field>
        <Field label="Branded average price (₹)" error={errors.branded_avg_mrp}>
          <input className="input-base" inputMode="decimal" value={form.branded_avg_mrp} onChange={set('branded_avg_mrp')} />
        </Field>
        <Field label="Pack size"><input className="input-base" value={form.pack_size} onChange={set('pack_size')} placeholder="10's" /></Field>
        <Field label="Manufacturer"><input className="input-base" value={form.manufacturer} onChange={set('manufacturer')} /></Field>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm" loading={saving}>Save medicine</Button>
      </div>
    </form>
  )
}

function AdminMedicines() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [visibility, setVisibility] = useState('all')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)   // null | 'new' | row
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState(null)
  const q = useDebounce(search.trim(), 300)

  const query = useQuery({
    queryKey: ['admin-medicines', q, category, visibility, page],
    placeholderData: keepPreviousData,
    queryFn: async () => (await adminManageService.listMedicines({
      q, category: category || undefined, visibility, page, page_size: PAGE_SIZE,
    })).data,
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-medicines'] })
    queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
  }

  const save = useMutation({
    mutationFn: (payload) => (editing === 'new'
      ? adminManageService.createMedicine(payload)
      : adminManageService.updateMedicine(editing.pmbi_code, payload)),
    onSuccess: () => { setEditing(null); setFormError(''); setNotice({ ok: true, text: 'Medicine saved.' }); refresh() },
    onError: (e) => {
      const d = e?.response?.data?.detail
      setFormError(typeof d === 'string' ? d : 'Please check the details and try again.')
    },
  })
  const toggle = useMutation({
    mutationFn: ({ code, show }) => (show ? adminManageService.showMedicine(code) : adminManageService.hideMedicine(code)),
    onSuccess: ({ data }) => { setNotice({ ok: true, text: data.message }); refresh() },
    onError: (e) => setNotice({ ok: false, text: e?.response?.data?.detail ?? 'Could not change it.' }),
  })

  const data = query.data
  const rows = data?.results ?? []
  const categories = data?.categories ?? []
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))
  const reset = (setter) => (e) => { setter(e.target.value); setPage(1) }

  return (
    <article aria-label="Medicine catalogue" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Medicine Catalogue</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {data ? `${data.total.toLocaleString('en-IN')} medicine${data.total === 1 ? '' : 's'}` : 'The Jan Aushadhi (PMBI) list shown to patients and pharmacies'}
          </p>
        </div>
        <Button size="sm" leftIcon={<HiOutlinePlus size={14} aria-hidden="true" />}
          onClick={() => { setFormError(''); setEditing('new') }}>Add medicine</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input aria-label="Search medicines" className="input-base flex-1" placeholder="Search by name, generic, composition or PMBI code…"
          value={search} onChange={reset(setSearch)} />
        <select aria-label="Filter by category" className="input-base sm:w-52" value={category} onChange={reset(setCategory)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Filter by visibility" className="input-base sm:w-40" value={visibility} onChange={reset(setVisibility)}>
          <option value="all">Visible + hidden</option><option value="active">Visible only</option><option value="hidden">Hidden only</option>
        </select>
      </div>

      {notice && (
        <p role={notice.ok ? 'status' : 'alert'}
          className={`text-sm rounded-lg p-3 border ${notice.ok ? 'bg-success-50 border-success-200 text-success-700' : 'bg-danger-50 border-danger-200 text-danger-700'}`}>
          {notice.text}
        </p>
      )}

      {query.isLoading && <p className="py-10 text-center text-sm text-slate-400" role="status">Loading medicines…</p>}
      {query.isError && <p role="alert" className="py-10 text-center text-sm text-danger-700">{query.error?.response?.data?.detail ?? 'Could not load medicines.'}</p>}

      {!query.isLoading && !query.isError && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base" aria-label="Medicines">
              <thead>
                <tr>
                  <th scope="col">Medicine</th><th scope="col" className="hidden lg:table-cell">Category</th>
                  <th scope="col">Price</th><th scope="col" className="hidden md:table-cell">Pack</th>
                  <th scope="col">Status</th><th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={6} className="text-center text-xs text-slate-400 py-8">No medicines match.</td></tr>}
                {rows.map((m) => (
                  <tr key={m.pmbi_code}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary-50 shrink-0">
                          <MdMedication size={14} className="text-primary-600" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate max-w-[240px]">{m.brand_name}</p>
                          <p className="text-[10px] text-slate-400 truncate max-w-[240px]">PMBI {m.pmbi_code} · {m.generic_name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden lg:table-cell"><Badge variant="neutral" size="sm">{m.category}</Badge></td>
                    <td className="text-xs">
                      <span className="font-bold text-slate-900">{formatINR(m.jan_aushadhi_mrp)}</span>
                      {m.saving_pct > 0 && <span className="text-success-700"> · {m.saving_pct}% cheaper</span>}
                    </td>
                    <td className="hidden md:table-cell text-xs text-slate-500">{m.pack_size || '-'}</td>
                    <td><Badge variant={m.is_active ? 'success' : 'neutral'} dot size="sm">{m.is_active ? 'Visible' : 'Hidden'}</Badge></td>
                    <td>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" leftIcon={<HiOutlinePencil size={13} aria-hidden="true" />}
                          onClick={() => { setFormError(''); setEditing(m) }}>Edit</Button>
                        <Button size="sm" variant="ghost" disabled={toggle.isPending}
                          leftIcon={m.is_active ? <HiOutlineEyeSlash size={13} aria-hidden="true" /> : <HiOutlineEye size={13} aria-hidden="true" />}
                          onClick={() => toggle.mutate({ code: m.pmbi_code, show: !m.is_active })}>
                          {m.is_active ? 'Hide' : 'Show'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            <span>Page {page} of {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add a medicine' : 'Edit medicine'} size="xl">
        {editing !== null && (
          <MedicineForm
            editing={editing !== 'new'} categories={categories}
            initial={editing === 'new' ? EMPTY : {
              pmbi_code: editing.pmbi_code, brand_name: editing.brand_name, generic_name: editing.generic_name,
              composition: editing.composition, category: editing.category,
              jan_aushadhi_mrp: String(editing.jan_aushadhi_mrp ?? ''), branded_avg_mrp: String(editing.branded_avg_mrp ?? ''),
              pack_size: editing.pack_size ?? '', manufacturer: editing.manufacturer ?? '',
            }}
            onSubmit={(payload) => save.mutate(payload)} onClose={() => setEditing(null)}
            saving={save.isPending} serverError={formError} />
        )}
      </Modal>
    </article>
  )
}

export default AdminMedicines