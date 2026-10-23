/** Dashboard welcome card: real name, greeting and date. */
import { HiOutlineCalendar } from 'react-icons/hi2'
import Avatar from '../../../components/ui/Avatar'
import { useAuth } from '../../../contexts/AuthContext'

function DashboardHeader() {
  const { currentUser } = useAuth()
  const name = currentUser?.name ?? 'there'
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <section aria-labelledby="dashboard-welcome">
      <div className="bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl p-6 text-white relative overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(white_1px,transparent_1px)] [background-size:28px_28px] opacity-5 pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <Avatar name={name} size="xl" online={true} />
          <div>
            <p className="text-primary-200 text-sm">{greeting},</p>
            <h1 id="dashboard-welcome" className="text-2xl font-extrabold text-white leading-tight">{name}</h1>
            <div className="flex items-center gap-1.5 text-primary-200 text-xs mt-1">
              <HiOutlineCalendar size={12} aria-hidden="true" />
              {today}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default DashboardHeader