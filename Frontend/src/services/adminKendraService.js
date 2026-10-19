/**
 * Admin Kendra Service  (ADMIN role only)
 *
 *  GET    /admin/kendras?q=
 *  POST   /admin/kendras
 *  PUT    /admin/kendras/:id
 *  POST   /admin/kendras/:id/hide | show | remove-owner
 *  DELETE /admin/kendras/:id
 */

import axiosClient from '../config/axiosClient'

const BASE = '/admin/kendras'

const adminKendraService = {
  list: (q = '') => axiosClient.get(BASE, { params: { q } }),
  create: (data) => axiosClient.post(BASE, data),
  update: (id, data) => axiosClient.put(`${BASE}/${id}`, data),
  hide: (id) => axiosClient.post(`${BASE}/${id}/hide`),
  show: (id) => axiosClient.post(`${BASE}/${id}/show`),
  removeOwner: (id) => axiosClient.post(`${BASE}/${id}/remove-owner`),
  remove: (id) => axiosClient.delete(`${BASE}/${id}`),
}

export default adminKendraService