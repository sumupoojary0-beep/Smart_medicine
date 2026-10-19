/**
 * Pharmacy Registration Service
 *
 *  GET  /pharmacy-registration/kendras?q=        public  - Kendras without an owner
 *  POST /pharmacy-registration/register          public  - account + pending request
 *  GET  /pharmacy-registration/my-request        signed-in user
 *  GET  /pharmacy-registration/requests          admin
 *  POST /pharmacy-registration/requests/:id/approve | reject   admin
 */

import axiosClient from '../config/axiosClient'

const BASE = '/pharmacy-registration'

const pharmacyRegistrationService = {
  searchKendras: (q = '') =>
    axiosClient.get(`${BASE}/kendras`, { params: { q, limit: 20 } }),

  register: (payload) => axiosClient.post(`${BASE}/register`, payload),

  getMyRequest: () => axiosClient.get(`${BASE}/my-request`),

  listRequests: (status) =>
    axiosClient.get(`${BASE}/requests`, { params: status ? { status } : {} }),

  approve: (id) => axiosClient.post(`${BASE}/requests/${id}/approve`),

  reject: (id, reason) =>
    axiosClient.post(`${BASE}/requests/${id}/reject`, { reason: reason || null }),
}

export default pharmacyRegistrationService