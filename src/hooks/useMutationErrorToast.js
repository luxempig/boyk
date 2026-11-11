import { useToast } from '../components/organisms/Toast'

// Default onError handler for TanStack Query mutations. Surfaces the failure
// to the user as an error toast instead of letting it die silently.
//
// Usage:
//   const onError = useMutationErrorToast('Could not add comment')
//   useMutation({ mutationFn, onSuccess, onError })
export function useMutationErrorToast(fallback = 'Action failed. Please try again.') {
  const toast = useToast()
  return err => {
    const message = err?.message || fallback
    toast.error(message)
  }
}
