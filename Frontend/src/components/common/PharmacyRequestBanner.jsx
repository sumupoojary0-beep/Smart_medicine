/**
 * PharmacyRequestBanner
 *
 * Shown to a signed-in patient who applied to become a pharmacy owner:
 *   PENDING  -> waiting for admin approval
 *   APPROVED -> the role is refreshed and the user is sent to the pharmacy dashboard
 *   REJECTED -> shows the reason
 * Shows nothing when the user never applied.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import pharmacyRegistrationService from '../../services/pharmacyRegistrationService'
import { ROUTES } from '../../constants/routes'

function PharmacyRequestBanner() {
  const { currentUser, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const handled = useRef(false)
  const [switchFailed, setSwitchFailed] = useState(false)

  const isPatient = currentUser?.role === 'patient'

  const { data } = useQuery({
    queryKey: ['my-pharmacy-request', currentUser?.email],
    queryFn: async () => (await pharmacyRegistrationService.getMyRequest()).data,
    enabled: isPatient,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.request?.status === 'PENDING' ? 60_000 : false),
    retry: false,
  })

  const request = data?.request ?? null
  const approved = request?.status === 'APPROVED'

  // Approved: pick up the new role, then open the pharmacy dashboard (once).
  useEffect(() => {
    if (!isPatient || !approved || handled.current) return
    handled.current = true
    refreshProfile()
      .then((user) => {
        if (user.role === 'pharmacist') navigate(ROUTES.PHARMACY.DASHBOARD, { replace: true })
        else setSwitchFailed(true)
      })
      .catch(() => setSwitchFailed(true))
  }, [isPatient, approved, refreshProfile, navigate])

  if (!isPatient || !request) return null

  if (request.status === 'PENDING') {
    return (
      <div role="status" className="px-4 sm:px-6 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-900">
        <strong>Pharmacy request pending.</strong>{' '}
        {request.email_verified
          ? <>Your request for <strong>{request.kendra_name}</strong> is waiting for admin approval. You can use the app as a patient meanwhile.</>
          : <>Verify your e-mail with the OTP we sent, then the admin can review your request for <strong>{request.kendra_name}</strong>.</>}
      </div>
    )
  }

  if (approved) {
    return (
      <div role="status" className="px-4 sm:px-6 py-2.5 bg-success-50 border-b border-success-200 text-xs text-success-800">
        <strong>Approved!</strong> You are now the owner of <strong>{request.kendra_name}</strong>.{' '}
        {switchFailed
          ? <>Please log out and log in again to open your pharmacy dashboard.</>
          : <>Opening your pharmacy dashboard…</>}
      </div>
    )
  }

  if (request.status === 'REJECTED') {
    return (
      <div role="alert" className="px-4 sm:px-6 py-2.5 bg-danger-50 border-b border-danger-200 text-xs text-danger-800">
        <strong>Pharmacy request not approved.</strong>{' '}
        {request.reject_reason ? <>Reason: {request.reject_reason}. </> : null}
        You can <Link to={ROUTES.REGISTER_PHARMACY} className="underline font-semibold">apply again</Link> or contact the admin.
      </div>
    )
  }

  return null
}

export default PharmacyRequestBanner