/** Saved medicines of the signed-in user (real, from the backend). */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import userService from '../services/userService'

const KEY = ['saved-medicines']

export default function useSavedMedicines() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => (await userService.getSavedMedicines()).data,
  })

  const toggle = useMutation({
    mutationFn: ({ pmbiCode, saved }) =>
      saved ? userService.unsaveMedicine(pmbiCode) : userService.saveMedicine(pmbiCode),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })

  const items = query.data?.items ?? []
  const isSaved = (pmbiCode) => items.some((m) => m.pmbi_code === pmbiCode)

  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    isSaved,
    toggle: (pmbiCode) => toggle.mutate({ pmbiCode, saved: isSaved(pmbiCode) }),
    isToggling: toggle.isPending,
  }
}