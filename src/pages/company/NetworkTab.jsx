import { lazy, Suspense } from 'react'

import Skeleton from '../../components/atoms/Skeleton'

const NvlPreview = lazy(() => import('../../components/organisms/NvlPreview'))

export default function NetworkTab({ company, connections }) {
  return (
    <div style={{ padding: 'var(--space-4) 0' }}>
      <Suspense fallback={<Skeleton variant='rect' height={300} />}>
        <NvlPreview company={company} connections={connections} />
      </Suspense>
    </div>
  )
}
