/**
 * Component: AdminUsers
 *
 * Description: Real user management - search, filter, suspend / re-activate,
 *              and change role between User and Admin.
 *
 * Backend: GET /admin/users, POST /admin/users/:id/status, POST /admin/users/:id/role
 *
 * Notes:
 *   - You cannot change your own account (the server refuses).
 *   - Pharmacy owners are linked to a Kendra: link or unlink them under
 *     Pharmacy Requests / Pharmacies, not here. Changing their role here unlinks the Kendra.
 *   - A suspended person cannot sign in; a session already open ends when its token expires.
 */

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HiOutlineNoSymbol, HiOutlineCheckCircle, HiOutlineShieldCheck, HiOutlineUser } from 'react-icons/hi2'
import Avatar from '../../components/ui/Avatar'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Modal from '../../components/dialogs/Modal'
import { useAuth } from '../../contexts/AuthContext'
import useDebounce from '../../hooks/useDebounce'
import adminManageService from '../../services/adminManageService'

const PAGE_SIZE = 10
const ROLE_VARIANT = { USER: 'neutral', PHARMACY: 'secondary', ADMIN: 'danger' }
const ROLE_LABEL = { USER: 'Patient', PHARMACY: 'Pharmacy owner', ADMIN: 'Admin' }
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-')

function AdminUsers() {
  const { currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [confirm, setConfirm] = useState(null)   // { user, kind: 'suspend'|'activate'|'makeAdmin'|'makeUser' }
  const [notice, setNotice] = useState(null)
  const q = useDebounce(search.trim(), 300)

  const query = useQuery({
    queryKey: ['admin-users', q, role, status, page],
    placeholderData: keepPreviousData,
    queryFn: async () => (await adminManageService.listUsers({
      q, role: role || undefined, status: status || undefined, page, page_size: PAGE_SIZE,
    })).data,
  })

  const act = useMutation({
    mutationFn: ({ user, kind }) => {
      if (kind === 'suspend') return adminManageService.setUserStatus(user.id, 'SUSPENDED')
      if (kind === 'activate') return adminManageService.setUserStatus(user.id, 'ACTIVE')
      return adminManageService.setUserRole(user.id, kind === 'makeAdmin' ? 'ADMIN' : 'USER')
    },
    onSuccess: ({ data }) => {
      setConfirm(null)
      setNotice({ ok: true, text: data.message })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
    },
    onError: (error) => {
      setConfirm(null)
      setNotice({ ok: false, text: error?.response?.data?.detail ?? 'Could not save the change.' })
    },
  })

  const data = query.data
  const rows = data?.results ?? []
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))
  const reset = (setter) => (e) => { setter(e.target.value); setPage(1) }

  const texts = {
    suspend:   (u) => ({ title: 'Suspend this account?', body: `${u.full_name} will not be able to sign in until you re-activate the account.`, button: 'Suspend', variant: 'danger' }),
    activate:  (u) => ({ title: 'Re-activate this account?', body: `${u.full_name} will be able to sign in again.`, button: 'Re-activate', variant: 'primary' }),
    makeAdmin: (u) => ({ title: 'Make this person an admin?', body: `${u.full_name} will get full admin access${u.role === 'PHARMACY' ? ' and be unlinked from their Kendra' : ''}.`, button: 'Make admin', variant: 'danger' }),
    makeUser:  (u) => ({ title: 'Make this person a normal user?', body: `${u.full_name} will lose admin${u.role === 'PHARMACY' ? ' / pharmacy' : ''} access.`, button: 'Make normal user', variant: 'danger' }),
  }
  const t = confirm ? texts[confirm.kind](confirm.user) : null

  return (
    <article aria-label="User management" className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">User Management</h1>
        <p className="text-xs text-slate-500 mt-0.5">{data ? `${data.total} user${data.total === 1 ? '' : 's'}` : 'Registered users across all roles'}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input aria-label="Search users" className="input-base flex-1" placeholder="Search by name, e-mail or phone…"
          value={search} onChange={reset(setSearch)} />
        <select aria-label="Filter by role" className="input-base sm:w-44" value={role} onChange={reset(setRole)}>
          <option value="">All roles</option><option value="USER">Patients</option>
          <option value="PHARMACY">Pharmacy owners</option><option value="ADMIN">Admins</option>
        </select>
        <select aria-label="Filter by status" className="input-base sm:w-40" value={status} onChange={reset(setStatus)}>
          <option value="">Any status</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option>
        </select>
      </div>

      {notice && (
        <p role={notice.ok ? 'status' : 'alert'}
          className={`text-sm rounded-lg p-3 border ${notice.ok ? 'bg-success-50 border-success-200 text-success-700' : 'bg-danger-50 border-danger-200 text-danger-700'}`}>
          {notice.text}
        </p>
      )}

      {query.isLoading && <p className="py-10 text-center text-sm text-slate-400" role="status">Loading users…</p>}
      {query.isError && <p role="alert" className="py-10 text-center text-sm text-danger-700">{query.error?.response?.data?.detail ?? 'Could not load users.'}</p>}

      {!query.isLoading && !query.isError && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base" aria-label="Users">
              <thead>
                <tr>
                  <th scope="col">User</th><th scope="col">Role</th><th scope="col">Status</th>
                  <th scope="col" className="hidden md:table-cell">Joined</th>
                  <th scope="col" className="hidden lg:table-cell">Last login</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-xs text-slate-400 py-8">No users match.</td></tr>
                )}
                {rows.map((u) => {
                  const isMe = u.email === currentUser?.email
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Avatar name={u.full_name || u.email} size="sm" />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate max-w-[180px]">{u.full_name}{isMe && <span className="text-slate-400 font-normal"> (you)</span>}</p>
                            <p className="text-[10px] text-slate-400 truncate max-w-[180px]">{u.email}</p>
                            {!u.is_email_verified && <p className="text-[10px] text-warning-700">E-mail not verified</p>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge variant={ROLE_VARIANT[u.role] ?? 'neutral'} size="sm">{ROLE_LABEL[u.role] ?? u.role}</Badge>
                        {u.kendra_name && <p className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[150px]">{u.kendra_name}</p>}
                      </td>
                      <td><Badge variant={u.status === 'ACTIVE' ? 'success' : 'danger'} dot size="sm">{u.status === 'ACTIVE' ? 'Active' : 'Suspended'}</Badge></td>
                      <td className="hidden md:table-cell text-xs text-slate-500">{fmtDate(u.created_at)}</td>
                      <td className="hidden lg:table-cell text-xs text-slate-500">{fmtDate(u.last_login)}</td>
                      <td>
                        {isMe ? <span className="text-[11px] text-slate-300">—</span> : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {u.status === 'ACTIVE'
                              ? <Button size="sm" variant="outline" leftIcon={<HiOutlineNoSymbol size={13} aria-hidden="true" />}
                                  onClick={() => setConfirm({ user: u, kind: 'suspend' })}>Suspend</Button>
                              : <Button size="sm" variant="outline" leftIcon={<HiOutlineCheckCircle size={13} aria-hidden="true" />}
                                  onClick={() => setConfirm({ user: u, kind: 'activate' })}>Activate</Button>}
                            {u.role === 'ADMIN'
                              ? <Button size="sm" variant="ghost" leftIcon={<HiOutlineUser size={13} aria-hidden="true" />}
                                  onClick={() => setConfirm({ user: u, kind: 'makeUser' })}>Make user</Button>
                              : u.is_email_verified && (
                                <Button size="sm" variant="ghost" leftIcon={<HiOutlineShieldCheck size={13} aria-hidden="true" />}
                                  onClick={() => setConfirm({ user: u, kind: 'makeAdmin' })}>Make admin</Button>)}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
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

      <Modal isOpen={confirm !== null} onClose={() => setConfirm(null)} title={t?.title ?? ''} description={t?.body ?? ''} size="sm"
        footer={confirm && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={t.variant} size="sm" loading={act.isPending} onClick={() => act.mutate(confirm)}>{t.button}</Button>
          </div>
        )} />
    </article>
  )
}

export default AdminUsers