/**
 * Component: UserDashboard
 *
 * Description:
 *   Personal healthcare dashboard for users.
 *
 * Responsibilities:
 *   - Dashboard overview with welcome header
 *   - Saved medicines management
 *   - Search history
 *   - Notifications
 *   - User profile and account settings
 *   - Future medicine reminders
 *
 * Route: /dashboard (ProtectedRoute → UserLayout)
 *
 * Backend readiness:
 *   All section data uses local placeholder state.
 *   Replace with TanStack Query calls in Module 11+:
 *     useQuery(['user-stats'], () => userService.getStats())
 *     useQuery(['saved-medicines'], () => userService.getSavedMedicines())
 *     useQuery(['notifications'], () => userService.getNotifications())
 *
 * Layout:
 *   Single column on mobile.
 *   Two-column grid on desktop for right sidebar (timeline + settings).
 */

import DashboardHeader          from './sections/DashboardHeader'
import QuickStats               from './sections/QuickStats'
import QuickActions             from './sections/QuickActions'
import SavedMedicinesSection    from './sections/SavedMedicinesSection'
import SearchHistorySection     from './sections/SearchHistorySection'
import NotificationCenter       from './sections/NotificationCenter'
import Divider                  from '../../components/ui/Divider'

function UserDashboard() {
  return (
    <article aria-label="User Dashboard" className="flex flex-col gap-5">

      {/* ======================================================
          Dashboard Overview
         ====================================================== */}
      <DashboardHeader />

      {/* ======================================================
          Quick Statistics
         ====================================================== */}
      <QuickStats />

      {/* ======================================================
          Quick Actions
         ====================================================== */}
      <QuickActions />

      <Divider className="my-0" />

      {/* Two-column layout on large screens */}
      <div className="grid grid-cols-1 gap-5">

        {/* ── Left column: main content ──────────────────────── */}
        <div className="flex flex-col gap-5">

          {/* ======================================================
              Saved Medicines
             ====================================================== */}
          <SavedMedicinesSection />

          {/* ======================================================
              Search History
             ====================================================== */}
          <SearchHistorySection />

          {/* ======================================================
              Notifications
             ====================================================== */}
          <NotificationCenter />

        </div>

      </div>

    </article>
  )
}

export default UserDashboard