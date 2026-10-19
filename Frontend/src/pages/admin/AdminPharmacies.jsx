/**
 * Component: AdminPharmacies
 *
 * Description: Admin manages the Jan Aushadhi Kendras in the system -
 *              add, edit, hide from patients, remove the owner, delete.
 *
 * Backend: GET/POST/PUT/DELETE /admin/kendras ...  (see adminKendraService)
 *
 * Safety: a Kendra that has an owner or sales history cannot be deleted;
 *         the server explains why and the admin can hide it instead.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineEye, HiOutlineEyeSlash,
  HiOutlineUserMinus, HiOutlineArrowPath,
} from 'react-icons/hi2'
import { MdLocalPharmacy } from 'react-icons/md'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Modal from '../../components/dialogs/Modal'
import { ROUTES } from '../../constants/routes'
import useDebounce from '../../hooks/useDebounce'
import adminKendraService from '../../services/adminKendraService'

const EMPTY = { name: '', address: '', phone: '', latitude: '', longitude: '', is_active: true }

function validate(f) {
  const e = {}
  if (f.name.trim().length < 2) e.name = 'Enter the Kendra name.'
  if (f.address.trim().length < 2) e.address = 'Enter the address.'
  const lat = Number(f.latitude), lng = Number(f.longitude)
  if (f.latitude === '' || Number.isNaN(lat) || lat < -90 || lat > 90) e.latitude = 'Latitude must be between -90 and 90.'
  if (f.longitude === '' || Number.isNaN(lng) || lng < -180 || lng > 180) e.longitude = 'Longitude must be between -180 and 180.'
  return e
}

function Field({ label, error, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {error && <span role="alert" className="text-xs text-danger-600">{error}</span>}
    </label>
  )
}

function KendraForm({ initial, onSubmit, onClose, saving, serverError }) {
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const set = (k) => (ev) => { setForm((f) => ({ ...f, [k]: ev.target.value })); setErrors((e) => ({ ...e, [k]: undefined })) }

  function submit(ev) {
    ev.preventDefault()
    const found = validate(form)
    setErrors(found)
    if (Object.keys(found).length) return
    onSubmit({
      name: form.name.trim(), address: form.address.trim(), phone: form.phone.trim() || null,
      latitude: Number(form.latitude), longitude: Number(form.longitude), is_active: form.is_active,
    })
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {serverError && <p role="alert" className="text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded-lg p-2.5">{serverError}</p>}
      <Field label="Kendra name *" error={errors.name}>
        <input className="input-base" value={form.name} onChange={set('name')} placeholder="Jan Aushadhi Kendra (PMBJK01234) - Town" />
      </Field>
      <Field label="Address *" error={errors.address}>
        <textarea className="input-base" rows={2} value={form.address} onChange={set('address')} />
      </Field>
      <Field label="Phone">
        <input className="input-base" value={form.phone} onChange={set('phone')} placeholder="+91 98xxxxxxxx" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude *" error={errors.latitude}>
          <input className="input-base" inputMode="decimal" value={form.latitude} onChange={set('latitude')} placeholder="12.3090" />
        </Field>
        <Field label="Longitude *" error={errors.longitude}>
          <input className="input-base" inputMode="decimal" value={form.longitude} onChange={set('longitude')} placeholder="76.6551" />
        </Field>
      </div>
      <p className="text-[11px] text-slate-400">Tip: in Google Maps, right-click the shop and click the numbers to copy latitude, longitude.</p>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
        Visible to patients
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm" loading={saving}>Save Kendra</Button>
      </div>
    </form>
  )
}

function AdminPharmacies() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const q = useDebounce(search.trim(), 300)
  const [editing, setEditing] = useState(null)      // null | 'new' | kendra row
  const [deleting, setDeleting] = useState(null)    // kendra row
  const [notice, setNotice] = useState(null)
  const [formError, setFormError] = useState('')

  const query = useQuery({
    queryKey: ['admin-kendras', q],
    queryFn: async () => (await adminKendraService.list(q)).data,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-kendras'] })
  const fail = (error) => setNotice({ ok: false, text: error?.response?.data?.detail ?? 'Something went wrong.' })
  const done = (data) => { setNotice({ ok: true, text: data?.message ?? 'Saved.' }); refresh() }

  const save = useMutation({
    mutationFn: (payload) => (editing === 'new'
      ? adminKendraService.create(payload)
      : adminKendraService.update(editing.id, payload)),
    onSuccess: () => { setEditing(null); setFormError(''); done({ message: 'Kendra saved.' }) },
    onError: (e) => setFormError(e?.response?.data?.detail ?? 'Could not save the Kendra.'),
  })
  const act = useMutation({
    mutationFn: ({ kind, id }) => adminKendraService[kind](id),
    onSuccess: ({ data }) => done(data),
    onError: fail,
  })
  const del = useMutation({
    mutationFn: (id) => adminKendraService.remove(id),
    onSuccess: ({ data }) => { setDeleting(null); done(data) },
    onError: (e) => { setDeleting(null); fail(e) },
  })

  const data = query.data
  const rows = data?.kendras ?? []
  const busy = act.isPending

  return (
    <article aria-label="Pharmacy management" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Pharmacy Management</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Add, edit, hide or delete Jan Aushadhi Kendras. Owners sign up under{' '}
            <Link to={ROUTES.ADMIN.PHARMACY_REQUESTS} className="text-primary-600 hover:underline">Pharmacy Requests</Link>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" loading={query.isFetching} onClick={() => query.refetch()}
            leftIcon={<HiOutlineArrowPath size={14} aria-hidden="true" />}>Refresh</Button>
          <Button size="sm" leftIcon={<HiOutlinePlus size={14} aria-hidden="true" />}
            onClick={() => { setFormError(''); setEditing('new') }}>Add Kendra</Button>
        </div>
      </div>

      {data && (
        <p className="text-xs text-slate-500">
          {data.total} Kendras · {data.active} visible · {data.without_owner} without an owner
        </p>
      )}

      <input aria-label="Search Kendras" className="input-base max-w-md" placeholder="Search by name or address…"
        value={search} onChange={(e) => setSearch(e.target.value)} />

      {notice && (
        <p role={notice.ok ? 'status' : 'alert'}
          className={`text-sm rounded-lg p-3 border ${notice.ok ? 'bg-success-50 border-success-200 text-success-700' : 'bg-danger-50 border-danger-200 text-danger-700'}`}>
          {notice.text}
        </p>
      )}

      {query.isLoading && <p className="py-10 text-center text-sm text-slate-400" role="status">Loading Kendras…</p>}
      {query.isError && <p role="alert" className="py-10 text-center text-sm text-danger-700">Could not load the Kendras.</p>}
      {!query.isLoading && !query.isError && rows.length === 0 && <p className="py-10 text-center text-sm text-slate-400">No Kendras found.</p>}

      <ul className="flex flex-col gap-3">
        {rows.map((k) => (
          <li key={k.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-start gap-3 min-w-0">
                <span className="p-2 rounded-xl bg-secondary-50 text-secondary-600"><MdLocalPharmacy size={18} aria-hidden="true" /></span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">{k.name}</p>
                  <p className="text-xs text-slate-500">{k.address}</p>
                  {k.phone && <p className="text-xs text-slate-400">{k.phone}</p>}
                </div>
              </div>
              <div className="flex gap-1.5">
                <Badge variant={k.is_active ? 'success' : 'neutral'} dot size="sm">{k.is_active ? 'Visible' : 'Hidden'}</Badge>
                {k.has_pending_request && <Badge variant="warning" size="sm">Request waiting</Badge>}
              </div>
            </div>

            <p className="text-xs text-slate-600">
              <span className="text-slate-400">Owner: </span>
              {k.owner ? `${k.owner.name} (${k.owner.email})` : <em className="text-slate-400">none yet</em>}
              <span className="text-slate-300"> · </span>{k.medicines} medicines stocked
            </p>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" leftIcon={<HiOutlinePencil size={14} aria-hidden="true" />}
                onClick={() => { setFormError(''); setEditing(k) }}>Edit</Button>
              {k.is_active
                ? <Button size="sm" variant="outline" disabled={busy} leftIcon={<HiOutlineEyeSlash size={14} aria-hidden="true" />}
                    onClick={() => act.mutate({ kind: 'hide', id: k.id })}>Hide</Button>
                : <Button size="sm" variant="outline" disabled={busy} leftIcon={<HiOutlineEye size={14} aria-hidden="true" />}
                    onClick={() => act.mutate({ kind: 'show', id: k.id })}>Show</Button>}
              {k.owner && (
                <Button size="sm" variant="outline" disabled={busy} leftIcon={<HiOutlineUserMinus size={14} aria-hidden="true" />}
                  onClick={() => act.mutate({ kind: 'removeOwner', id: k.id })}>Remove owner</Button>
              )}
              <Button size="sm" variant="danger" leftIcon={<HiOutlineTrash size={14} aria-hidden="true" />}
                onClick={() => setDeleting(k)}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>

      <Modal isOpen={editing !== null} onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add a Kendra' : 'Edit Kendra'} size="md">
        {editing !== null && (
          <KendraForm
            initial={editing === 'new' ? EMPTY : {
              name: editing.name, address: editing.address, phone: editing.phone ?? '',
              latitude: String(editing.latitude ?? ''), longitude: String(editing.longitude ?? ''), is_active: editing.is_active,
            }}
            onSubmit={(payload) => save.mutate(payload)} onClose={() => setEditing(null)}
            saving={save.isPending} serverError={formError} />
        )}
      </Modal>

      <Modal isOpen={deleting !== null} onClose={() => setDeleting(null)} title="Delete this Kendra?" size="sm"
        description={deleting ? `${deleting.name} will be removed permanently. If it has an owner or sales history the server will refuse - hide it instead.` : ''}
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" size="sm" loading={del.isPending} onClick={() => del.mutate(deleting.id)}>Delete</Button>
          </div>
        )} />
    </article>
  )
}

export default AdminPharmacies