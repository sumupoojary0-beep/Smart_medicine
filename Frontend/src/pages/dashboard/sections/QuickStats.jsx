/** Dashboard numbers: all real (saved medicines, recent searches, unread notifications). */
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { HiOutlineBookmark, HiOutlineMagnifyingGlass, HiOutlineBell } from 'react-icons/hi2'
import InfoCard from '../../../components/cards/InfoCard'
import { ROUTES } from '../../../constants/routes'
import notificationService from '../../../services/notificationService'
import useSavedMedicines from '../../../hooks/useSavedMedicines'
import useRecentSearches from '../../../hooks/useRecentSearches'

function QuickStats() {
  const navigate = useNavigate()
  const { items: saved } = useSavedMedicines()
  const { items: searches } = useRecentSearches()
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await notificationService.getMyNotifications()).data,
  })
  const notifications = data?.results ?? []
  const unread = data?.unread ?? 0

  const stats = [
    { label: 'Medicines Saved', value: String(saved.length), variant: 'primary', icon: <HiOutlineBookmark size={18} />, subtitle: 'Your personal list', route: null },
    { label: 'Recent Searches', value: String(searches.length), variant: 'default', icon: <HiOutlineMagnifyingGlass size={18} />, subtitle: 'On this device', route: ROUTES.USER.SEARCH },
    { label: 'Notifications', value: String(notifications.length), variant: unread ? 'danger' : 'default', icon: <HiOutlineBell size={18} />, subtitle: `${unread} unread`, route: ROUTES.USER.NOTIFICATIONS },
  ]

  return (
    <section aria-labelledby="quick-stats-heading">
      <h2 id="quick-stats-heading" className="sr-only">Dashboard statistics</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {stats.map((s) => (
          <InfoCard
            key={s.label}
            label={s.label}
            value={s.value}
            variant={s.variant}
            icon={s.icon}
            subtitle={s.subtitle}
            onClick={s.route ? () => navigate(s.route) : undefined}
          />
        ))}
      </div>
    </section>
  )
}

export default QuickStats