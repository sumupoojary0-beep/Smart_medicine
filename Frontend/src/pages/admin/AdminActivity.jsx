/**
 * Component: AdminActivity
 *
 * Real audit log: every admin change (users, medicines, Kendras, pharmacy
 * requests) with who did it and when. Data: GET /api/v1/admin/audit-logs
 */

import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { HiOutlineUser, HiOutlineShieldCheck, HiOutlineClipboardDocumentCheck } from 'react-icons/hi2'
import { MdLocalPharmacy, MdMedication } from 'react-icons/md'
import auditService from '../../services/auditService'

const PAGE_SIZE = 20

const TYPES = [
  { key: '', label: 'All' },
  { key: 'user', label: 'Users' },
  { key: 'medicine', label: 'Medicines' },
  { key: 'kendra', label: 'Kendras' },
  { key: 'pharmacy_request', label: 'Pharmacy requests' },
]

const ICONS = {
  user: { Icon: HiOutlineUser, bg: 'bg-primary-100', color: 'text-primary-700' },
  medicine: { Icon: MdMedication, bg: 'bg-success-100', color: 'text-success-700' },
  kendra: { Icon: MdLocalPharmacy, bg: 'bg-secondary-100', color: 'text-secondary-700' },
  pharmacy_request: { Icon: HiOutlineClipboardDocumentCheck, bg: 'bg-warning-100', color: 'text-warning-700' },
}
const FALLBACK = { Icon: HiOutlineShieldCheck, bg: 'bg-slate-100', color: 'text-slate-600' }

const formatWhen = (value) =>
  value
    ? new Date(value.endsWith?.('Z') || /[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '-'

function AdminActivity() {
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['audit-logs', type, search, page],
    queryFn: async () => (await auditService.getLogs({ target_type: type || undefined, q: search || undefined, page, page_size: PAGE_SIZE })).data,
    placeholderData: keepPreviousData,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <article aria-label="Activity Logs" className="flex flex-col gap-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Activity Logs</h1>
        <p className="text-xs text-slate-400 mt-0.5">A record of who changed what on the platform.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <button
            key={t.key || 'all'}
            onClick={() => { setType(t.key); setPage(1) }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              type === t.key
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search by admin, action or ID"
          aria-label="Search activity"
          className="ml-auto w-full sm:w-64 px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading activity...</p>
        ) : isError ? (
          <div className="text-sm text-danger-600">
            Could not load the activity log.{' '}
            <button onClick={() => refetch()} className="underline font-semibold">Try again</button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">
            No activity recorded yet. Changes made by admins from now on will appear here.
          </p>
        ) : (
          <ol className="relative" aria-label="Platform activity timeline">
            {items.map((log, i) => {
              const cfg = ICONS[log.target_type] ?? FALLBACK
              const Icon = cfg.Icon
              return (
                <li key={log.id} className="flex gap-4 pb-5 last:pb-0">
                  <div className="flex flex-col items-center shrink-0 w-9">
                    <div className={`flex items-center justify-center w-9 h-9 rounded-full ${cfg.bg}`}>
                      <Icon size={16} className={cfg.color} aria-hidden="true" />
                    </div>
                    {i < items.length - 1 && <div className="w-0.5 flex-1 mt-1 bg-slate-100" aria-hidden="true" />}
                  </div>
                  <div className="flex-1 min-w-0 pt-1.5">
                    <p className="text-sm font-semibold text-slate-800">{log.summary || log.action}</p>
                    <p className="text-xs text-slate-500 mt-0.5 break-all">
                      by {log.actor}
                      {log.target_id ? ` · ${log.target_type} ${log.target_id}` : ''}
                      {log.details?.reason ? ` · reason: ${log.details.reason}` : ''}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">{formatWhen(log.created_at)}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{total} entries{isFetching ? ' · updating…' : ''}</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40"
            >
              Previous
            </button>
            <span>Page {page} of {pages}</span>
            <button
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </article>
  )
}

export default AdminActivity