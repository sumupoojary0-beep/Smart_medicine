/**
 * Component: InventoryDashboard
 *
 * Description:
 *   One-screen health check of the pharmacy owner's Kendra: how much stock
 *   there is, what is running low or out, what is about to expire (or
 *   already has), how sales are going, and what happened recently.
 *
 * Backend:
 *   GET /api/v1/kendras/:id/inventory/dashboard
 *
 * Notes:
 *   Expired batches are not counted as sellable stock. A medicine whose
 *   only remaining stock has expired shows up under "Out of stock".
 */

import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  HiOutlineArrowPath, HiOutlineExclamationTriangle, HiOutlineCube,
  HiOutlineBanknotes, HiOutlineArchiveBox, HiOutlineClock,
  HiOutlineSquares2X2, HiOutlineReceiptPercent, HiOutlinePlus, HiOutlineArrowDownTray,
} from 'react-icons/hi2'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import { ROUTES } from '../../constants/routes'
import { useAuth } from '../../contexts/AuthContext'
import kendraService from '../../services/kendraService'
import reportService, { REPORTS } from '../../services/reportService'
import { formatINR } from '../../utils/billing'

const MAX_ROWS = 6

function StatCard({ label, value, hint, icon: Icon, tone = 'primary' }) {
  const tones = {
    primary: 'bg-primary-50 text-primary-600',
    success: 'bg-success-100 text-success-700',
    warning: 'bg-warning-100 text-warning-700',
    danger:  'bg-danger-100 text-danger-700',
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-start gap-3">
      <span className={`p-2 rounded-xl ${tones[tone]}`}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-xl font-extrabold text-slate-900 leading-tight">{value}</p>
        {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
      </div>
    </div>
  )
}

function Panel({ title, count, tone, emptyText, children }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden" aria-label={title}>
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        <Badge variant={count > 0 ? tone : 'success'} size="sm">{count}</Badge>
      </header>
      {count === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-slate-400">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-slate-100">{children}</ul>
      )}
    </section>
  )
}

function Row({ title, subtitle, right }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{title}</p>
        {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
      </div>
      <div className="shrink-0 text-right">{right}</div>
    </li>
  )
}

function More({ total }) {
  if (total <= MAX_ROWS) return null
  return (
    <li className="px-4 py-2 text-center text-[11px] text-slate-400">
      + {total - MAX_ROWS} more — see{' '}
      <Link to={ROUTES.PHARMACY.INVENTORY} className="text-primary-600 hover:underline">Inventory</Link>
    </li>
  )
}

function SalesTrend({ data }) {
  const max = Math.max(...data.map((d) => d.total), 1)
  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4" aria-label="Sales in the last 7 days">
      <h2 className="text-sm font-bold text-slate-900 mb-3">Sales — last 7 days</h2>
      <div className="flex items-end gap-2 h-28">
        {data.map((d) => {
          const day = new Date(`${d.date}T00:00:00`)
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1 h-full"
                 title={`${d.date}: ${formatINR(d.total)}`}>
              <div
                className="w-full rounded-t-md bg-primary-500/80"
                style={{ height: `${Math.max((d.total / max) * 100, d.total > 0 ? 4 : 0)}%` }}
                role="img"
                aria-label={`${d.date}: ${formatINR(d.total)}`}
              />
              <span className="text-[10px] text-slate-400">
                {day.toLocaleDateString('en-IN', { weekday: 'short' })}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function InventoryDashboard() {
  const { currentUser } = useAuth()
  const kendraId = currentUser?.assignedKendraId ?? null
  const [downloading, setDownloading] = useState(null)
  const [reportError, setReportError] = useState('')

  async function downloadReport(key) {
    setReportError('')
    setDownloading(key)
    try {
      await reportService.download(kendraId, REPORTS[key])
    } catch (error) {
      setReportError(error.message)
    } finally {
      setDownloading(null)
    }
  }

  const query = useQuery({
    queryKey: ['kendra', kendraId, 'dashboard'],
    enabled: Boolean(kendraId),
    queryFn: async () => (await kendraService.getInventoryDashboard(kendraId)).data,
  })

  if (!kendraId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
        <HiOutlineExclamationTriangle size={28} className="text-warning-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-700">No Kendra assigned to your account yet.</p>
        <p className="text-xs text-slate-500 max-w-sm">
          An admin needs to link your account to a Jan Aushadhi Kendra before the dashboard can show your stock.
        </p>
      </div>
    )
  }

  if (query.isLoading) {
    return <p className="py-20 text-center text-sm text-slate-400" role="status">Loading inventory…</p>
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center py-20 gap-3 text-center">
        <p role="alert" className="text-sm text-danger-700">
          {query.error?.response?.data?.detail ?? 'Could not load the inventory dashboard.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>Try again</Button>
      </div>
    )
  }

  const { kendra, summary: s, low_stock, out_of_stock, near_expiry, expired, sales_trend, recent_activity } = query.data

  return (
    <article aria-label="Inventory dashboard" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Inventory Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">{kendra.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm"
            leftIcon={<HiOutlineArrowPath size={14} aria-hidden="true" />}
            loading={query.isFetching} onClick={() => query.refetch()}>
            Refresh
          </Button>
          <Button variant="outline" size="sm" loading={downloading === 'outOfStock'} disabled={downloading !== null}
            leftIcon={<HiOutlineArrowDownTray size={14} aria-hidden="true" />}
            onClick={() => downloadReport('outOfStock')}>
            Out-of-stock PDF
          </Button>
          <Button variant="outline" size="sm" loading={downloading === 'expired'} disabled={downloading !== null}
            leftIcon={<HiOutlineArrowDownTray size={14} aria-hidden="true" />}
            onClick={() => downloadReport('expired')}>
            Expired PDF
          </Button>
          <Link to={ROUTES.PHARMACY.INVENTORY_ADD}>
            <Button size="sm" leftIcon={<HiOutlinePlus size={14} aria-hidden="true" />}>Add stock</Button>
          </Link>
          <Link to={ROUTES.PHARMACY.BILLING}>
            <Button size="sm" variant="secondary" leftIcon={<HiOutlineReceiptPercent size={14} aria-hidden="true" />}>New bill</Button>
          </Link>
        </div>
      </div>

      {reportError && (
        <p role="alert" className="text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded-lg p-3">
          {reportError}
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Medicines stocked" value={s.total_medicines} hint={`${s.in_stock} well stocked`} icon={HiOutlineSquares2X2} />
        <StatCard label="Units in stock" value={s.total_units.toLocaleString('en-IN')} hint={`Worth ${formatINR(s.inventory_value)}`} icon={HiOutlineCube} tone="success" />
        <StatCard label="Sales today" value={formatINR(s.sales_today)} hint={`${s.bills_today} bill${s.bills_today === 1 ? '' : 's'} · ${formatINR(s.sales_7_days)} this week`} icon={HiOutlineBanknotes} tone="success" />
        <StatCard label="Needs attention" value={s.low_stock + s.out_of_stock + s.near_expiry_batches + s.expired_batches}
          hint={`${s.expired_batches} expired · ${s.near_expiry_batches} expiring soon`} icon={HiOutlineExclamationTriangle}
          tone={s.expired_batches > 0 || s.out_of_stock > 0 ? 'danger' : 'warning'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Expired — do not sell" count={s.expired_batches} tone="danger" emptyText="No expired batches.">
          {expired.slice(0, MAX_ROWS).map((b) => (
            <Row key={`${b.pmbi_code}-${b.batch_number}`} title={b.medicine_name}
              subtitle={`Batch ${b.batch_number} · ${b.quantity} units`}
              right={<Badge variant="danger" size="sm">Expired {Math.abs(b.days_left)}d ago</Badge>} />
          ))}
          <More total={expired.length} />
        </Panel>

        <Panel title="Expiring soon" count={s.near_expiry_batches} tone="warning" emptyText="Nothing expiring in the next 60 days.">
          {near_expiry.slice(0, MAX_ROWS).map((b) => (
            <Row key={`${b.pmbi_code}-${b.batch_number}`} title={b.medicine_name}
              subtitle={`Batch ${b.batch_number} · ${b.quantity} units`}
              right={<Badge variant={b.level === 'red' ? 'danger' : 'warning'} size="sm">{b.days_left} days left</Badge>} />
          ))}
          <More total={near_expiry.length} />
        </Panel>

        <Panel title="Low stock" count={s.low_stock} tone="warning" emptyText="No medicines running low.">
          {low_stock.slice(0, MAX_ROWS).map((m) => (
            <Row key={m.pmbi_code} title={m.medicine_name} subtitle={m.pmbi_code}
              right={<Badge variant="warning" size="sm">{m.quantity} left</Badge>} />
          ))}
          <More total={low_stock.length} />
        </Panel>

        <Panel title="Out of stock" count={s.out_of_stock} tone="danger" emptyText="Nothing is out of stock.">
          {out_of_stock.slice(0, MAX_ROWS).map((m) => (
            <Row key={m.pmbi_code} title={m.medicine_name} subtitle={m.pmbi_code}
              right={
                <Link to={ROUTES.PHARMACY.INVENTORY_ADD} className="text-xs font-semibold text-primary-600 hover:underline">
                  Restock
                </Link>
              } />
          ))}
          <More total={out_of_stock.length} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SalesTrend data={sales_trend} />

        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden" aria-label="Recent activity">
          <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <HiOutlineClock size={16} className="text-slate-400" aria-hidden="true" />
            <h2 className="text-sm font-bold text-slate-900">Recent activity</h2>
          </header>
          {recent_activity.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400">No activity yet. Restock or bill something to see it here.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent_activity.map((a, i) => (
                <Row key={i} title={a.title} subtitle={a.detail}
                  right={<span className="text-[11px] text-slate-400">{new Date(a.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </article>
  )
}

export default InventoryDashboard