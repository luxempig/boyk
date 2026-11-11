// TanStack Query hooks for user-claimed companies, connections, and evidence.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  addEvidence,
  addUserCompany,
  addUserConnection,
  fetchBoycottUserClaims,
  listEvidence,
  removeEvidence,
  removeUserCompany,
  removeUserConnection,
  removeVote,
  setVote,
} from '../services/userClaims'
import { useMutationErrorToast } from './useMutationErrorToast'

const QK = {
  bundle: boycottId => ['user-claims', boycottId, 'bundle'],
  evidence: (kind, id) => ['user-claims', 'evidence', kind, id],
}

export function useBoycottUserClaims(boycottId) {
  return useQuery({
    queryKey: QK.bundle(boycottId),
    queryFn: () => fetchBoycottUserClaims(boycottId),
    enabled: !!boycottId,
    staleTime: 30_000,
  })
}

export function useEvidence(parentKind, parentId) {
  return useQuery({
    queryKey: QK.evidence(parentKind, parentId),
    queryFn: () => listEvidence(parentKind, parentId),
    enabled: !!parentKind && !!parentId,
    staleTime: 30_000,
  })
}

export function useAddUserCompany(boycottId) {
  const qc = useQueryClient()
  const onError = useMutationErrorToast('Could not add company to boycott.')
  return useMutation({
    mutationFn: input => addUserCompany(boycottId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.bundle(boycottId) }),
    onError,
  })
}

export function useRemoveUserCompany(boycottId) {
  const qc = useQueryClient()
  const onError = useMutationErrorToast('Could not remove company.')
  return useMutation({
    mutationFn: removeUserCompany,
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.bundle(boycottId) }),
    onError,
  })
}

export function useAddUserConnection(boycottId) {
  const qc = useQueryClient()
  const onError = useMutationErrorToast('Could not add connection.')
  return useMutation({
    mutationFn: input => addUserConnection(boycottId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.bundle(boycottId) }),
    onError,
  })
}

export function useRemoveUserConnection(boycottId) {
  const qc = useQueryClient()
  const onError = useMutationErrorToast('Could not remove connection.')
  return useMutation({
    mutationFn: removeUserConnection,
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.bundle(boycottId) }),
    onError,
  })
}

export function useAddEvidence(boycottId) {
  const qc = useQueryClient()
  const onError = useMutationErrorToast('Could not add evidence.')
  return useMutation({
    mutationFn: ({ parentKind, parentId, ...payload }) =>
      addEvidence(parentKind, parentId, payload),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: QK.evidence(vars.parentKind, vars.parentId) })
      if (boycottId) qc.invalidateQueries({ queryKey: QK.bundle(boycottId) })
    },
    onError,
  })
}

export function useRemoveEvidence(boycottId) {
  const qc = useQueryClient()
  const onError = useMutationErrorToast('Could not remove evidence.')
  return useMutation({
    mutationFn: ({ evidenceId }) => removeEvidence(evidenceId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: QK.evidence(vars.parentKind, vars.parentId) })
      if (boycottId) qc.invalidateQueries({ queryKey: QK.bundle(boycottId) })
    },
    onError,
  })
}

// Toggle a vote on a user-claim. Pass stance='agree' or 'disagree'; if the
// caller is already at that stance, the mutation withdraws the vote (acts as
// a tap-to-toggle).
export function useToggleVote(boycottId) {
  const qc = useQueryClient()
  const onError = useMutationErrorToast('Could not record vote.')
  return useMutation({
    mutationFn: async ({ targetKind, targetId, stance, currentMine }) => {
      if (currentMine === stance) {
        await removeVote(targetKind, targetId)
        return { withdrawn: true }
      }
      return setVote(targetKind, targetId, stance)
    },
    onSuccess: () => {
      if (boycottId) qc.invalidateQueries({ queryKey: QK.bundle(boycottId) })
    },
    onError,
  })
}
