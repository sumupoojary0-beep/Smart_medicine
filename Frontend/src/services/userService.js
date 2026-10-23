/**
 * User Service: the signed-in user's own account.
 *  GET    /auth/me                              profile
 *  PUT    /users/me/profile                     { full_name, phone_number }
 *  POST   /users/me/change-password             { current_password, new_password }
 *  GET    /users/me/saved-medicines             saved list (with medicine details)
 *  PUT    /users/me/saved-medicines/:pmbi_code  save
 *  DELETE /users/me/saved-medicines/:pmbi_code  unsave
 */
import axiosClient from '../config/axiosClient'

const userService = {
  getMe: () => axiosClient.get('/auth/me'),
  updateProfile: (data) => axiosClient.put('/users/me/profile', data),
  changePassword: (data) => axiosClient.post('/users/me/change-password', data),

  getSavedMedicines: () => axiosClient.get('/users/me/saved-medicines'),
  saveMedicine: (pmbiCode) => axiosClient.put(`/users/me/saved-medicines/${encodeURIComponent(pmbiCode)}`),
  unsaveMedicine: (pmbiCode) => axiosClient.delete(`/users/me/saved-medicines/${encodeURIComponent(pmbiCode)}`),
}

export default userService