/**
 * Component: PharmacyDashboard
 *
 * Description:
 *   Home page of a pharmacy owner. Everything shown is real data for the
 *   owner's own Kendra - sales, stock health, what needs attention, and the
 *   quick actions used every day.
 *
 * Route: /pharmacy/dashboard  (ProtectedRoute -> PharmacyLayout)
 *
 * Backend:
 *   GET /api/v1/kendras/:id/inventory/dashboard   (same call as Inventory Overview,
 *   so both pages share one cached response)
 */

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  HiOutlineArrowPath, HiOutlineBanknotes, HiOutlineCube, HiOutlineExclamationTriangle,
  HiOutlineReceiptPercent, HiOutlinePlus, HiOutlineArrowUpTray, HiOutlineChartBar,
  HiOutlineClock, HiOutlineArchiveBox,
} from 'react-icons/hi2'
import { MdLocalPharmacy } from 'react-icons/md'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import { ROUTES } from '../../constants/routes'
import { useAuth } from '../../contexts/AuthContext'
import kendraService from '../../services/kendraService'
import { formatINR } from '../../utils/billing'

const TOP = 4

function StatCard({ label, value, hint, icon: Icon, tone = 'primary' }) {
  const tones = {
    primary: 'bg-primary-50 text-primary-600',
    success: 'bg-success-100 text-success-700',
    warning: 'bg-warning-100 text-warning-700',
    danger:  'bg-danger-100 text-danger-700',
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-start gap-3">
      <span className={`p-2 rounded-xl ${tones[tone]}`}><Icon size={18} aria-hidden="true" /></span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-xl font-extrabold text-slate-900 leading-tight">{value}</p>
        {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
      </div>
    </div>
  )
}

function Alert({ title, count, tone, items, render, emptyText }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden" aria-label={title}>
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        <Badge variant={count > 0 ? tone : 'success'} size="sm">{count}</Badge>
      </header>
      {count === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-slate-400">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, TOP).map(render)}
          {count > TOP && (
            <li className="px-4 py-2 text-center text-[11px] text-slate-400">
              + {count - TOP} more —{' '}
              <Link to={ROUTES.PHARMACY.INVENTORY_DASHBOARD} className="text-primary-600 hover:underline">see all</Link>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function Line({ title, subtitle, right }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{title}</p>
        <p className="text-xs text-slate-500 truncate">{subtitle}</p>
      </div>
      <div className="shrink-0">{right}</div>
    </li>
  )
}

function QuickAction({ to, icon: Icon, label, hint }) {
  return (
    <Link to={to}
      className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-white hover:border-primary-200 hover:bg-primary-50/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
      <span className="p-2 rounded-lg bg-secondary-50 text-secondary-600"><Icon size={18} aria-hidden="true" /></span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        <span className="block text-[11px] text-slate-500">{hint}</span>
      </span>
    </Link>
  )
}

function PharmacyDashboard() {
  const { currentUser } = useAuth()
  const kendraId = currentUser?.assignedKendraId ?? null

  const query = useQuery({
    queryKey: ['kendra', kendraId, 'dashboard'],
    enabled: Boolean(kendraId),
    queryFn: async () => (await kendraService.getInventoryDashboard(kendraId)).data,
  })

  if (!kendraId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
        <HiOutlineExclamationTriangle size={28} className="text-warning-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-700">No Kendra is linked to your account yet.</p>
        <p className="text-xs text-slate-500 max-w-sm">
          An admin links your account to your Kendra after approving your pharmacy request. Log out and in again once it is approved.
        </p>
      </div>
    )
  }
  if (query.isLoading) return <p className="py-20 text-center text-sm text-slate-400" role="status">Loading your dashboard…</p>
  if (query.isError) {
    return (
      <div className="flex flex-col items-center py-20 gap-3 text-center">
        <p role="alert" className="text-sm text-danger-700">{query.error?.response?.data?.detail ?? 'Could not load the dashboard.'}</p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>Try again</Button>
      </div>
    )
  }

  const { kendra, summary: s, low_stock, out_of_stock, near_expiry, expired, sales_trend } = query.data
  const attention = s.low_stock + s.out_of_stock + s.near_expiry_batches + s.expired_batches
  const max = Math.max(...sales_trend.map((d) => d.total), 1)

  return (
    <article aria-label="Pharmacy dashboard" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <MdLocalPharmacy size={26} className="text-secondary-600" aria-hidden="true" />
            Welcome{currentUser?.name ? `, ${currentUser.name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">{kendra.name}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" loading={query.isFetching} onClick={() => query.refetch()}
            leftIcon={<HiOutlineArrowPath size={14} aria-hidden="true" />}>Refresh</Button>
          <Link to={ROUTES.PHARMACY.INVENTORY_DASHBOARD}>
            <Button size="sm" variant="secondary" leftIcon={<HiOutlineChartBar size={14} aria-hidden="true" />}>Full inventory overview</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Sales today" value={formatINR(s.sales_today)}
          hint={`${s.bills_today} bill${s.bills_today === 1 ? '' : 's'} today`} icon={HiOutlineBanknotes} tone="success" />
        <StatCard label="Sales — last 7 days" value={formatINR(s.sales_7_days)} icon={HiOutlineChartBar} />
        <StatCard label="Units in stock" value={s.total_units.toLocaleString('en-IN')}
          hint={`${s.total_medicines} medicines · worth ${formatINR(s.inventory_value)}`} icon={HiOutlineCube} tone="success" />
        <StatCard label="Needs attention" value={attention}
          hint={`${s.out_of_stock} out · ${s.low_stock} low · ${s.expired_batches} expired`} icon={HiOutlineExclamationTriangle}
          tone={s.expired_batches > 0 || s.out_of_stock > 0 ? 'danger' : attention > 0 ? 'warning' : 'success'} />
      </div>

      <section aria-label="Quick actions" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <QuickAction to={ROUTES.PHARMACY.BILLING} icon={HiOutlineReceiptPercent} label="New bill" hint="Sell medicines, print a GST invoice" />
        <QuickAction to={ROUTES.PHARMACY.INVENTORY_ADD} icon={HiOutlinePlus} label="Add stock" hint="Add a batch by hand" />
        <QuickAction to={ROUTES.PHARMACY.INVENTORY_IMPORT} icon={HiOutlineArrowUpTray} label="Import supplier bill" hint="Photo, PDF, Excel or CSV" />
        <QuickAction to={ROUTES.PHARMACY.BILL_HISTORY} icon={HiOutlineArchiveBox} label="Bill history" hint="Past invoices and reprints" />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Alert title="Expired — do not sell" count={s.expired_batches} tone="danger" items={expired} emptyText="No expired batches."
          render={(b) => (
            <Line key={`${b.pmbi_code}-${b.batch_number}`} title={b.medicine_name}
              subtitle={`Batch ${b.batch_number} · ${b.quantity} units`}
              right={<Badge variant="danger" size="sm">Expired {Math.abs(b.days_left)}d ago</Badge>} />
          )} />
        <Alert title="Expiring soon" count={s.near_expiry_batches} tone="warning" items={near_expiry} emptyText="Nothing expires in the next 60 days."
          render={(b) => (
            <Line key={`${b.pmbi_code}-${b.batch_number}`} title={b.medicine_name}
              subtitle={`Batch ${b.batch_number} · ${b.quantity} units`}
              right={<Badge variant={b.level === 'red' ? 'danger' : 'warning'} size="sm">{b.days_left} days left</Badge>} />
          )} />
        <Alert title="Out of stock" count={s.out_of_stock} tone="danger" items={out_of_stock} emptyText="Nothing is out of stock."
          render={(m) => (
            <Line key={m.pmbi_code} title={m.medicine_name} subtitle={m.pmbi_code}
              right={<Link to={ROUTES.PHARMACY.INVENTORY_ADD} className="text-xs font-semibold text-primary-600 hover:underline">Restock</Link>} />
          )} />
        <Alert title="Low stock" count={s.low_stock} tone="warning" items={low_stock} emptyText="No medicines running low."
          render={(m) => (
            <Line key={m.pmbi_code} title={m.medicine_name} subtitle={m.pmbi_code}
              right={<Badge variant="warning" size="sm">{m.quantity} left</Badge>} />
          )} />
      </div>

      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4" aria-label="Sales in the last 7 days">
        <h2 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
          <HiOutlineClock size={15} className="text-slate-400" aria-hidden="true" /> Sales — last 7 days
        </h2>
        <div className="flex items-end gap-2 h-28">
          {sales_trend.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={`${d.date}: ${formatINR(d.total)}`}>
              <div className="w-full rounded-t-md bg-primary-500/80" role="img" aria-label={`${d.date}: ${formatINR(d.total)}`}
                style={{ height: `${Math.max((d.total / max) * 100, d.total > 0 ? 4 : 0)}%` }} />
              <span className="text-[10px] text-slate-400">
                {new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' })}
              </span>
            </div>
          ))}
        </div>
      </section>
    </article>
  )
}

export default PharmacyDashboard