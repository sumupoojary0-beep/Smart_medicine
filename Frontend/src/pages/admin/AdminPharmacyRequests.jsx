/**
 * Component: AdminPharmacyRequests
 *
 * Description: Admin reviews pharmacy-owner sign-ups. Approving links the
 *              applicant to their Kendra and gives them the pharmacy role.
 *
 * Backend:
 *   GET  /pharmacy-registration/requests?status=
 *   POST /pharmacy-registration/requests/:id/approve
 *   POST /pharmacy-registration/requests/:id/reject   { reason }
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HiOutlineCheckCircle, HiOutlineXCircle, HiOutlineArrowPath } from 'react-icons/hi2'
import { MdLocalPharmacy } from 'react-icons/md'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import pharmacyRegistrationService from '../../services/pharmacyRegistrationService'

const TABS = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: '', label: 'All' },
]
const VARIANT = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' }

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'

function RequestCard({ request, busy, onApprove, onReject }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const pending = request.status === 'PENDING'

  return (
    <li className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <span className="p-2 rounded-xl bg-secondary-50 text-secondary-600">
            <MdLocalPharmacy size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">{request.kendra_name}</p>
            <p className="text-xs text-slate-500">
              {request.full_name} · {request.email} · {request.phone_number}
            </p>
          </div>
        </div>
        <Badge variant={VARIANT[request.status] ?? 'neutral'} dot size="sm">{request.status}</Badge>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
        <div><dt className="text-slate-400">Licence / code</dt><dd className="font-mono text-slate-700">{request.license_no || '-'}</dd></div>
        <div><dt className="text-slate-400">Requested</dt><dd className="text-slate-700">{formatDate(request.created_at)}</dd></div>
        <div>
          <dt className="text-slate-400">E-mail</dt>
          <dd className={request.email_verified ? 'text-success-700' : 'text-warning-700'}>
            {request.email_verified ? 'Verified' : 'Not verified yet'}
          </dd>
        </div>
        {request.decided_at && <div><dt className="text-slate-400">Decided</dt><dd className="text-slate-700">{formatDate(request.decided_at)}</dd></div>}
      </dl>

      {request.message && <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2.5">“{request.message}”</p>}
      {request.reject_reason && <p className="text-xs text-danger-700">Reason: {request.reject_reason}</p>}

      {pending && !rejecting && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || !request.email_verified}
            leftIcon={<HiOutlineCheckCircle size={14} aria-hidden="true" />}
            onClick={() => onApprove(request)}>
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
            leftIcon={<HiOutlineXCircle size={14} aria-hidden="true" />}
            onClick={() => setRejecting(true)}>
            Reject
          </Button>
          {!request.email_verified && (
            <span className="text-[11px] text-slate-400">Can be approved once the applicant verifies their e-mail.</span>
          )}
        </div>
      )}

      {pending && rejecting && (
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label={`Reason for rejecting ${request.kendra_name}`} value={reason}
            onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)"
            className="input-base flex-1 min-w-[200px]" />
          <Button size="sm" variant="danger" disabled={busy} onClick={() => onReject(request, reason)}>Confirm reject</Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
        </div>
      )}
    </li>
  )
}

function AdminPharmacyRequests() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('PENDING')
  const [notice, setNotice] = useState(null)

  const query = useQuery({
    queryKey: ['pharmacy-requests', tab],
    queryFn: async () => (await pharmacyRegistrationService.listRequests(tab)).data,
  })

  const decide = useMutation({
    mutationFn: ({ request, reason, approve }) =>
      approve
        ? pharmacyRegistrationService.approve(request.id)
        : pharmacyRegistrationService.reject(request.id, reason),
    onSuccess: ({ data }) => {
      setNotice({ ok: true, text: data.message })
      queryClient.invalidateQueries({ queryKey: ['pharmacy-requests'] })
    },
    onError: (error) =>
      setNotice({ ok: false, text: error?.response?.data?.detail ?? 'Could not save the decision.' }),
  })

  const counts = query.data?.counts ?? {}
  const requests = query.data?.requests ?? []

  return (
    <article aria-label="Pharmacy requests" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Pharmacy Requests</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Owners who signed up for a Kendra. Check the licence, then approve or reject.
          </p>
        </div>
        <Button variant="outline" size="sm" loading={query.isFetching} onClick={() => query.refetch()}
          leftIcon={<HiOutlineArrowPath size={14} aria-hidden="true" />}>
          Refresh
        </Button>
      </div>

      <div role="tablist" aria-label="Request status" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.label} type="button" role="tab" aria-selected={tab === t.key}
            onClick={() => { setTab(t.key); setNotice(null) }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              tab === t.key ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            {t.label}{t.key && counts[t.key] !== undefined ? ` (${counts[t.key]})` : ''}
          </button>
        ))}
      </div>

      {notice && (
        <p role={notice.ok ? 'status' : 'alert'}
          className={`text-sm rounded-lg p-3 border ${notice.ok
            ? 'bg-success-50 border-success-200 text-success-700'
            : 'bg-danger-50 border-danger-200 text-danger-700'}`}>
          {notice.text}
        </p>
      )}

      {query.isLoading && <p className="py-10 text-center text-sm text-slate-400" role="status">Loading requests…</p>}
      {query.isError && (
        <p role="alert" className="py-10 text-center text-sm text-danger-700">
          {query.error?.response?.data?.detail ?? 'Could not load the requests.'}
        </p>
      )}
      {!query.isLoading && !query.isError && requests.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-400">Nothing here.</p>
      )}

      <ul className="flex flex-col gap-3">
        {requests.map((request) => (
          <RequestCard key={request.id} request={request} busy={decide.isPending}
            onApprove={(r) => decide.mutate({ request: r, approve: true })}
            onReject={(r, reason) => decide.mutate({ request: r, approve: false, reason })} />
        ))}
      </ul>
    </article>
  )
}

export default AdminPharmacyRequests