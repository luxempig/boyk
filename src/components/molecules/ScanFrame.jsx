import { motion } from 'framer-motion'

import { scanLineSweep } from '../../lib/animations'

const cornerStyle = (top, left, right, bottom) => ({
  position: 'absolute',
  width: 24,
  height: 24,
  ...(top !== undefined && { top }),
  ...(bottom !== undefined && { bottom }),
  ...(left !== undefined && { left }),
  ...(right !== undefined && { right }),
  borderColor: 'var(--accent)',
  borderStyle: 'solid',
  borderWidth: 0,
  ...(top !== undefined &&
    left !== undefined && { borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 }),
  ...(top !== undefined &&
    right !== undefined && { borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 }),
  ...(bottom !== undefined &&
    left !== undefined && {
      borderBottomWidth: 3,
      borderLeftWidth: 3,
      borderBottomLeftRadius: 8,
    }),
  ...(bottom !== undefined &&
    right !== undefined && {
      borderBottomWidth: 3,
      borderRightWidth: 3,
      borderBottomRightRadius: 8,
    }),
  filter: 'drop-shadow(0 0 4px var(--accent-glow))',
})

export function ScanFrame({ scanning = false, size = 260, className }) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: size,
        height: size,
        margin: '0 auto',
      }}
    >
      <div style={cornerStyle(0, 0, undefined, undefined)} />
      <div style={cornerStyle(0, undefined, 0, undefined)} />
      <div style={cornerStyle(undefined, 0, undefined, 0)} />
      <div style={cornerStyle(undefined, undefined, 0, 0)} />

      {scanning && (
        <motion.div
          {...scanLineSweep}
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            height: 2,
            background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
            boxShadow: '0 0 8px var(--accent-glow)',
          }}
        />
      )}

      {!scanning && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-body)',
          }}
        >
          Tap to scan
        </div>
      )}
    </div>
  )
}

export default ScanFrame
