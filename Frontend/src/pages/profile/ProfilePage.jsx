/**
 * Component: ProfilePage
 *
 * Real account page:
 *   - edit name and phone  -> PUT  /api/v1/users/me/profile
 *   - change password      -> POST /api/v1/users/me/change-password
 *   - best-pharmacy ranking preferences (patients)
 * The e-mail address is the login and cannot be changed here.
 */

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HiOutlineUser, HiOutlineShieldCheck } from 'react-icons/hi2'
import Avatar from '../../components/ui/Avatar'
import Badge from '../../components/ui/Badge'
import Input from '../../components/forms/Input'
import Button from '../../components/ui/Button'
import PharmacyRankingPreferences from '../../components/profile/PharmacyRankingPreferences'
import { useAuth } from '../../contexts/AuthContext'
import userService from '../../services/userService'

const profileSchema = z.object({
  name: z.string().trim().min(3, 'Name must be at least 3 characters').max(100),
  phone: z.string().trim().regex(/^\+?\d{10,14}$/, 'Enter a valid phone number (10–14 digits)'),
})

const passwordSchema = z
  .object({
    current: z.string().min(8, 'Enter your current password'),
    next: z.string().min(8, 'At least 8 characters').max(100),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })

const apiError = (error, fallback) => {
  const detail = error?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg.replace(/^Value error, /, '')
  return fallback
}

// ======================================
// Personal information
// ======================================
function ProfileForm({ me }) {
  const { refreshProfile } = useAuth()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState(null)

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: me.full_name ?? '', phone: me.phone_number ?? '' },
  })

  const save = useMutation({
    mutationFn: (v) => userService.updateProfile({ full_name: v.name, phone_number: v.phone }),
    onSuccess: async () => {
      setMessage({ ok: true, text: 'Profile updated.' })
      queryClient.invalidateQueries({ queryKey: ['me'] })
      await refreshProfile?.()
    },
    onError: (e) => setMessage({ ok: false, text: apiError(e, 'Could not update your profile.') }),
  })

  return (
    <form onSubmit={handleSubmit((v) => { setMessage(null); save.mutate(v) })} noValidate className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="Full Name" required error={errors.name?.message} {...register('name')} />
        <Input label="Email Address" type="email" value={me.email ?? ''} readOnly disabled helperText="Your login e-mail cannot be changed here" />
      </div>
      <Input label="Mobile Number" type="tel" required error={errors.phone?.message} {...register('phone')} placeholder="10-digit mobile number" />
      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" variant="primary" loading={save.isPending}>Save Changes</Button>
        {message && (
          <p role="status" className={`text-xs ${message.ok ? 'text-success-700' : 'text-danger-600'}`}>{message.text}</p>
        )}
      </div>
    </form>
  )
}

// ======================================
// Change password
// ======================================
function PasswordForm() {
  const { logout } = useAuth()
  const [message, setMessage] = useState(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current: '', next: '', confirm: '' },
  })

  const change = useMutation({
    mutationFn: (v) => userService.changePassword({ current_password: v.current, new_password: v.next }),
    onSuccess: () => {
      reset()
      setMessage({ ok: true, text: 'Password changed. Signing you out so you can log in again…' })
      // The server signs out all devices when the password changes.
      setTimeout(() => logout?.(), 1800)
    },
    onError: (e) => setMessage({ ok: false, text: apiError(e, 'Could not change your password.') }),
  })

  return (
    <form onSubmit={handleSubmit((v) => { setMessage(null); change.mutate(v) })} noValidate className="space-y-3">
      <Input label="Current password" type="password" autoComplete="current-password" error={errors.current?.message} {...register('current')} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="New password" type="password" autoComplete="new-password" error={errors.next?.message} {...register('next')} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" loading={change.isPending}>Change Password</Button>
        {message && (
          <p role="status" className={`text-xs ${message.ok ? 'text-success-700' : 'text-danger-600'}`}>{message.text}</p>
        )}
      </div>
    </form>
  )
}

// ======================================
// Page
// ======================================
function ProfilePage() {
  const { currentUser } = useAuth()
  const role = currentUser?.role ?? 'patient'

  const { data: me, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await userService.getMe()).data,
  })

  const name = me?.full_name ?? currentUser?.name ?? ''
  const email = me?.email ?? currentUser?.email ?? ''

  return (
    <article aria-label="Profile" className="max-w-2xl mx-auto flex flex-col gap-5">
      <div className="bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-4">
          <Avatar name={name || 'User'} size="xl" online={true} />
          <div>
            <h1 className="text-xl font-extrabold text-white">{name}</h1>
            <p className="text-primary-200 text-sm">{email}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant="success" size="sm" dot>Active</Badge>
              <Badge variant="primary" size="sm">{role}</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-100 pb-2">
          <HiOutlineUser size={15} className="text-primary-600" aria-hidden="true" />
          Personal Information
        </h2>
        {isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : isError || !me ? (
          <p className="text-sm text-danger-600">Could not load your profile. Please refresh the page.</p>
        ) : (
          <ProfileForm key={me.id} me={me} />
        )}
      </div>

      {role === 'patient' && <PharmacyRankingPreferences />}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h2 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
          <HiOutlineShieldCheck size={15} className="text-success-600" aria-hidden="true" />
          Change Password
        </h2>
        <PasswordForm />
      </div>
    </article>
  )
}

export default ProfilePage