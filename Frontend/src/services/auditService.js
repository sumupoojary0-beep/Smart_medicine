/**
 * Audit log (Admin only): who changed what.
 *  GET /admin/audit-logs?q=&target_type=&page=&page_size=
 */
import axiosClient from '../config/axiosClient'

const auditService = {
  getLogs: (params) => axiosClient.get('/admin/audit-logs', { params }),
}

export default auditService