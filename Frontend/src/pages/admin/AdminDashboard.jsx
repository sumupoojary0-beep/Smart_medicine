/**
 * Component: AdminDashboard
 *
 * Description: Admin home. Every number is real - users, Kendras, medicines,
 *              pending pharmacy requests, sales across all Kendras, and stock
 *              and expiry alerts.
 *
 * Route: /admin/dashboard  (ProtectedRoute -> AdminLayout)
 * Backend: GET /api/v1/admin/overview
 */

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  HiOutlineUsers, HiOutlineBanknotes, HiOutlineExclamationTriangle, HiOutlineArrowPath,
  HiOutlineUserPlus, HiOutlineArchiveBox, HiOutlineChartBar,
} from 'react-icons/hi2'
import { MdLocalPharmacy, MdMedication } from 'react-icons/md'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import { ROUTES } from '../../constants/routes'
import adminManageService from '../../services/adminManageService'
import { formatINR } from '../../utils/billing'

const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'

function Stat({ label, value, hint, icon: Icon, tone = 'primary', to }) {
  const tones = {
    primary: 'bg-primary-50 text-primary-600', success: 'bg-success-100 text-success-700',
    warning: 'bg-warning-100 text-warning-700', danger: 'bg-danger-100 text-danger-700',
  }
  const body = (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-start gap-3 h-full hover:border-primary-200 transition-colors">
      <span className={`p-2 rounded-xl ${tones[tone]}`}><Icon size={18} aria-hidden="true" /></span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-xl font-extrabold text-slate-900 leading-tight">{value}</p>
        {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
      </div>
    </div>
  )
  return to ? <Link to={to} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-2xl">{body}</Link> : body
}

function Card({ title, action, children }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden" aria-label={title}>
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}

const Empty = ({ children }) => <p className="px-4 py-6 text-center text-xs text-slate-400">{children}</p>

function AdminDashboard() {
  const query = useQuery({
    queryKey: ['admin-overview'],
    queryFn: async () => (await adminManageService.getOverview()).data,
  })

  if (query.isLoading) return <p className="py-20 text-center text-sm text-slate-400" role="status">Loading dashboard…</p>
  if (query.isError) {
    return (
      <div className="flex flex-col items-center py-20 gap-3 text-center">
        <p role="alert" className="text-sm text-danger-700">
          {query.error?.response?.data?.detail ?? 'Could not load the dashboard. Are you signed in as a real admin (not the demo)?'}
        </p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>Try again</Button>
      </div>
    )
  }

  const { users, kendras, medicines, pending_requests: pending, stock, sales, recent_signups } = query.data
  const trend = sales.daily_trend
  const max = Math.max(...trend.map((d) => d.revenue), 1)
  const alerts = stock.out_of_stock + stock.low_stock + stock.expired_count + stock.red_count

  return (
    <article aria-label="Admin dashboard" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Admin Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">The whole Jan Aushadhi network at a glance</p>
        </div>
        <Button variant="outline" size="sm" loading={query.isFetching} onClick={() => query.refetch()}
          leftIcon={<HiOutlineArrowPath size={14} aria-hidden="true" />}>Refresh</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="Registered users" value={users.total} to={ROUTES.ADMIN.USERS} icon={HiOutlineUsers}
          hint={`+${users.new_7_days} this week · ${users.by_role.PHARMACY} pharmacy · ${users.by_role.ADMIN} admin`} />
        <Stat label="Kendras" value={`${kendras.active} / ${kendras.total}`} to={ROUTES.ADMIN.PHARMACIES} icon={MdLocalPharmacy} tone="success"
          hint={`${kendras.without_owner} without an owner`} />
        <Stat label="Medicines in catalogue" value={medicines.total.toLocaleString('en-IN')} to={ROUTES.ADMIN.MEDICINES} icon={MdMedication}
          hint={medicines.hidden ? `${medicines.hidden} hidden` : 'All visible'} />
        <Stat label="Pharmacy requests waiting" value={pending.count} to={ROUTES.ADMIN.PHARMACY_REQUESTS} icon={HiOutlineUserPlus}
          tone={pending.count > 0 ? 'warning' : 'success'} hint={pending.count > 0 ? 'Needs your decision' : 'All caught up'} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="Sales today" value={formatINR(sales.revenue.today)} hint={`${sales.orders.today} bills`} icon={HiOutlineBanknotes} tone="success" />
        <Stat label="Sales this week" value={formatINR(sales.revenue.week)} hint={`${sales.orders.week} bills`} icon={HiOutlineChartBar} />
        <Stat label="Sales this month" value={formatINR(sales.revenue.month)} hint={`${sales.orders.month} bills`} icon={HiOutlineChartBar} />
        <Stat label="Stock alerts" value={alerts} to={ROUTES.ADMIN.INVENTORY} icon={HiOutlineExclamationTriangle}
          tone={stock.expired_count > 0 || stock.out_of_stock > 0 ? 'danger' : alerts > 0 ? 'warning' : 'success'}
          hint={`${stock.out_of_stock} out · ${stock.low_stock} low · ${stock.expired_count} expired · ${stock.red_count} expiring ≤30d`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Pending pharmacy requests"
          action={<Link to={ROUTES.ADMIN.PHARMACY_REQUESTS} className="text-xs font-semibold text-primary-600 hover:underline">Review</Link>}>
          {pending.latest.length === 0 ? <Empty>No requests waiting.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {pending.latest.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{r.kendra_name}</p>
                    <p className="text-xs text-slate-500 truncate">{r.full_name}</p>
                  </div>
                  <span className="text-[11px] text-slate-400 shrink-0">{fmtDate(r.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Newest users"
          action={<Link to={ROUTES.ADMIN.USERS} className="text-xs font-semibold text-primary-600 hover:underline">All users</Link>}>
          {recent_signups.length === 0 ? <Empty>No users yet.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {recent_signups.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{u.full_name}</p>
                    <p className="text-xs text-slate-500 truncate">{u.email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant={u.role === 'ADMIN' ? 'danger' : u.role === 'PHARMACY' ? 'secondary' : 'neutral'} size="sm">{u.role}</Badge>
                    <p className="text-[11px] text-slate-400 mt-0.5">{fmtDate(u.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Sales — last 7 days (all Kendras)">
          <div className="flex items-end gap-2 h-32 p-4">
            {trend.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={`${d.date}: ${formatINR(d.revenue)}`}>
                <div className="w-full rounded-t-md bg-primary-500/80" role="img" aria-label={`${d.date}: ${formatINR(d.revenue)}`}
                  style={{ height: `${Math.max((d.revenue / max) * 100, d.revenue > 0 ? 4 : 0)}%` }} />
                <span className="text-[10px] text-slate-400">{new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' })}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Top-selling medicines"
          action={<Link to={ROUTES.ADMIN.ANALYTICS} className="text-xs font-semibold text-primary-600 hover:underline">Analytics</Link>}>
          {sales.top_selling.length === 0 ? <Empty>No sales yet.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {sales.top_selling.map((m, i) => (
                <li key={m.pmbi_code} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <p className="text-sm text-slate-900 truncate"><span className="text-slate-400 mr-2">{i + 1}.</span>{m.medicine_name}</p>
                  <span className="text-xs text-slate-500 shrink-0">{m.quantity} units · {formatINR(m.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section aria-label="Shortcuts" className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: ROUTES.ADMIN.INVENTORY, label: 'Inventory monitor', icon: HiOutlineArchiveBox },
          { to: ROUTES.ADMIN.EXPIRY, label: 'Expiry monitor', icon: HiOutlineExclamationTriangle },
          { to: ROUTES.ADMIN.REPORTS, label: 'Sales reports', icon: HiOutlineChartBar },
          { to: ROUTES.ADMIN.PHARMACIES, label: 'Manage Kendras', icon: MdLocalPharmacy },
        ].map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-100 bg-white text-sm font-semibold text-slate-700 hover:border-primary-200 hover:bg-primary-50/40 transition-colors">
            <Icon size={17} className="text-primary-600" aria-hidden="true" /> {label}
          </Link>
        ))}
      </section>
    </article>
  )
}

export default AdminDashboard