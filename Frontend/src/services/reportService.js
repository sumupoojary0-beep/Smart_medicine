/**
 * Report Service - downloadable PDF reports for a Kendra.
 *
 *  GET /kendras/:id/reports/out-of-stock.pdf
 *  GET /kendras/:id/reports/expired.pdf
 *
 * The request goes through axiosClient so the login token is sent
 * (a plain <a href> link could not carry it).
 */

import axiosClient from '../config/axiosClient'

export const REPORTS = {
  outOfStock: { path: 'out-of-stock.pdf', fallbackName: 'out-of-stock.pdf' },
  expired:    { path: 'expired.pdf',      fallbackName: 'expired-medicines.pdf' },
}

function fileNameFrom(headers, fallback) {
  const header = headers?.['content-disposition'] || ''
  const match = /filename="?([^";]+)"?/i.exec(header)
  return match ? match[1] : fallback
}

/** Error responses arrive as a Blob when responseType is 'blob' - read the message out of it. */
async function readError(error) {
  const data = error?.response?.data
  if (data instanceof Blob) {
    try {
      const body = JSON.parse(await data.text())
      if (body?.detail) return typeof body.detail === 'string' ? body.detail : 'Could not create the report.'
    } catch { /* not JSON */ }
  }
  return 'Could not create the report. Please try again.'
}

const reportService = {
  async download(kendraId, report) {
    try {
      const response = await axiosClient.get(`/kendras/${kendraId}/reports/${report.path}`, {
        responseType: 'blob',
        timeout: 60000,
      })
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = fileNameFrom(response.headers, report.fallbackName)
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (error) {
      throw new Error(await readError(error))
    }
  },
}

export default reportService