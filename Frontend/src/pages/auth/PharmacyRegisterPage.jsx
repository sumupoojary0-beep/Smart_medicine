/**
 * Pharmacy Register Page
 *
 * Route   : /register/pharmacy  (inside AuthLayout -> PublicRoute)
 * Purpose : A Jan Aushadhi Kendra owner creates an account AND asks to manage
 *           their Kendra. The account is a normal one until an admin approves
 *           the request (Admin -> Pharmacy Requests); then the owner gets the
 *           pharmacy dashboard on the next login.
 *
 * Backend : GET  /pharmacy-registration/kendras?q=
 *           POST /pharmacy-registration/register   -> then /verify-otp
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FiAlertCircle } from 'react-icons/fi'
import { MdLocalPharmacy } from 'react-icons/md'

import { ROUTES } from '../../constants/routes'
import useDebounce from '../../hooks/useDebounce'
import pharmacyRegistrationService from '../../services/pharmacyRegistrationService'
import Input from '../../components/forms/Input'
import PasswordInput from '../../components/forms/PasswordInput'
import Button from '../../components/ui/Button'

const EMPTY = {
  fullName: '', email: '', mobile: '', password: '', confirmPassword: '',
  licenseNo: '', message: '',
}

function validate(form, kendra) {
  const errors = {}
  if (form.fullName.trim().length < 3) errors.fullName = 'Enter your full name (at least 3 letters).'
  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errors.email = 'Enter a valid e-mail address.'
  if (!/^\d{10}$/.test(form.mobile.trim())) errors.mobile = 'Enter a 10-digit mobile number.'
  if (form.password.length < 8) errors.password = 'Use at least 8 characters.'
  if (form.confirmPassword !== form.password) errors.confirmPassword = 'Passwords do not match.'
  if (!kendra) errors.kendra = 'Pick your Kendra from the list.'
  if (form.licenseNo.trim().length < 4) errors.licenseNo = 'Enter your drug licence / PMBJK code so the admin can verify you.'
  return errors
}

function PharmacyRegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [kendra, setKendra] = useState(null)
  const [search, setSearch] = useState('')
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const debouncedSearch = useDebounce(search.trim(), 300)
  const kendras = useQuery({
    queryKey: ['open-kendras', debouncedSearch],
    queryFn: async () => (await pharmacyRegistrationService.searchKendras(debouncedSearch)).data,
  })

  const set = (key) => (event) => {
    setForm((f) => ({ ...f, [key]: event.target.value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function onSubmit(event) {
    event.preventDefault()
    setServerError('')
    const found = validate(form, kendra)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSubmitting(true)
    try {
      const email = form.email.trim().toLowerCase()
      await pharmacyRegistrationService.register({
        full_name: form.fullName.trim(),
        email,
        phone_number: form.mobile.trim(),
        password: form.password,
        kendra_id: kendra.id,
        license_no: form.licenseNo.trim(),
        message: form.message.trim() || null,
      })
      navigate(ROUTES.VERIFY_OTP, { replace: true, state: { email, flow: 'register' } })
    } catch (error) {
      const detail = error?.response?.data?.detail
      setServerError(
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? 'Please check the form - some details are not valid.'
            : 'Registration failed. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const results = kendras.data?.results ?? []

  return (
    <div>
      <div className="text-center mb-6">
        <span className="inline-flex p-2.5 rounded-xl bg-primary-50 text-primary-600 mb-2">
          <MdLocalPharmacy size={22} aria-hidden="true" />
        </span>
        <h1 className="text-xl font-bold text-slate-900">Register your Kendra</h1>
        <p className="text-sm text-slate-500 mt-1">
          For Jan Aushadhi Kendra owners. An admin checks your details before you get access.
        </p>
      </div>

      {serverError && (
        <div role="alert" className="flex items-start gap-2.5 mb-4 p-3 rounded-lg bg-danger-50 border border-danger-200 text-danger-700 text-sm">
          <FiAlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{serverError}</span>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Input label="Your full name" required autoComplete="name" placeholder="Owner's full name"
          value={form.fullName} onChange={set('fullName')} error={errors.fullName} />
        <Input label="E-mail address" type="email" required autoComplete="email" placeholder="you@example.com"
          value={form.email} onChange={set('email')} error={errors.email} />
        <Input label="Mobile number" type="tel" required autoComplete="tel" placeholder="10-digit mobile number"
          value={form.mobile} onChange={set('mobile')} error={errors.mobile} />
        <PasswordInput label="Password" required autoComplete="new-password" placeholder="At least 8 characters"
          value={form.password} onChange={set('password')} error={errors.password} />
        <PasswordInput label="Confirm password" required autoComplete="new-password" placeholder="Enter the password again"
          value={form.confirmPassword} onChange={set('confirmPassword')} error={errors.confirmPassword} />

        {/* ── Kendra picker ─────────────────────────────────────────── */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">
            Your Kendra <span className="text-danger-500">*</span>
          </legend>

          {kendra ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-primary-200 bg-primary-50 p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{kendra.name}</p>
                <p className="text-xs text-slate-500">{kendra.address}</p>
              </div>
              <button type="button" onClick={() => setKendra(null)}
                className="text-xs font-medium text-primary-600 hover:underline shrink-0">
                Change
              </button>
            </div>
          ) : (
            <>
              <Input aria-label="Search your Kendra" placeholder="Search by Kendra name or town"
                value={search} onChange={(e) => { setSearch(e.target.value); setErrors((x) => ({ ...x, kendra: undefined })) }} />
              <ul className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white"
                aria-label="Kendras without an owner">
                {kendras.isLoading && <li className="p-3 text-xs text-slate-400">Searching…</li>}
                {kendras.isError && <li className="p-3 text-xs text-danger-600">Could not load Kendras. Is the backend running?</li>}
                {!kendras.isLoading && !kendras.isError && results.length === 0 && (
                  <li className="p-3 text-xs text-slate-500">
                    No free Kendra found. It may already have an owner - ask your admin.
                  </li>
                )}
                {results.map((k) => (
                  <li key={k.id}>
                    <button type="button" disabled={k.has_pending_request}
                      onClick={() => { setKendra(k); setErrors((x) => ({ ...x, kendra: undefined })) }}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
                      <p className="text-sm font-medium text-slate-900">{k.name}</p>
                      <p className="text-xs text-slate-500">
                        {k.address}
                        {k.has_pending_request && ' · request already waiting'}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {errors.kendra && <p role="alert" className="text-xs text-danger-600">{errors.kendra}</p>}
        </fieldset>

        <Input label="Drug licence / PMBJK code" required placeholder="e.g. KA-MNG-20-1234"
          helperText="The admin uses this to confirm the Kendra is yours."
          value={form.licenseNo} onChange={set('licenseNo')} error={errors.licenseNo} />
        <Input label="Note for the admin (optional)" placeholder="Anything that helps verify you"
          value={form.message} onChange={set('message')} />

        <Button type="submit" variant="primary" fullWidth loading={submitting} disabled={submitting} className="mt-2">
          Create account &amp; request access
        </Button>
      </form>

      <p className="text-center text-sm text-slate-500 mt-6">
        Not a pharmacy owner?{' '}
        <Link to={ROUTES.REGISTER} className="font-medium text-primary-600 hover:underline">Create a patient account</Link>
        {' · '}
        <Link to={ROUTES.LOGIN} className="font-medium text-primary-600 hover:underline">Sign in</Link>
      </p>
    </div>
  )
}

export default PharmacyRegisterPage