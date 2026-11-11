/**
 * @component Landing
 * @level Page
 * @interactions Public landing shown at `/`. Introduces the project, links
 *               into the read-only demo and to the source code.
 *
 *               Color comes from the app's connection-data palette (the same
 *               tokens that color the corporate graph): blue = parents,
 *               green = subsidiaries, purple = brands, amber = suppliers,
 *               cyan = customers, pink = people/resist. Using the real tokens
 *               keeps the page on-brand and theme-adaptive (light/dark).
 */
import { Boxes, Github, Network, ScanBarcode, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

import { DEMO_SNAPSHOT_DATE, SOURCE_URL } from '../lib/demo'

// Each feature is tinted with the connection color that matches what it does,
// so the palette means the same thing here as it does inside the app.
const FEATURES = [
  {
    icon: Boxes,
    color: 'var(--conn-owned-by)', // blue — ownership graph (parents/subsidiaries)
    title: 'Map corporate ownership',
    body: 'See who really owns a brand — parent companies, subsidiaries, and the chains between them, drawn from a knowledge graph of 105,000+ companies and 43,000+ brands.',
  },
  {
    icon: ScanBarcode,
    color: 'var(--conn-customers)', // cyan — products
    title: 'Scan a product',
    body: 'Scan a barcode and trace it from product to brand to the company that profits — so you can decide with the full picture in hand.',
  },
  {
    icon: Network,
    color: 'var(--highlight)', // pink — resist / organize
    title: 'Build & track boycotts',
    body: 'Create a boycott targeting a company and automatically include its subsidiaries and brands. Follow campaigns others have built and see them grow.',
  },
  {
    icon: ShieldCheck,
    color: 'var(--success)', // green — verified / sourced
    title: 'Every claim is sourced',
    body: 'Connections carry their provenance — GLEIF, Wikidata, SEC filings, and other public records — with a confidence signal on each, so you can check the receipts.',
  },
]

// Each entity gets its canonical color from the connection palette.
const STATS = [
  { value: '105,000+', label: 'Companies', color: 'var(--conn-owned-by)' }, // blue
  { value: '43,000+', label: 'Brands', color: 'var(--conn-brands)' }, // purple
  { value: '116,000+', label: 'Products', color: 'var(--conn-customers)' }, // cyan
  { value: '8,000+', label: 'People', color: 'var(--highlight)' }, // pink
]

// Public sources behind the graph, each with a colored marker — a nod to the
// confidence-dot / provenance system used throughout the app.
const SOURCES = [
  { label: 'GLEIF', color: 'var(--conn-owned-by)' },
  { label: 'Wikidata', color: 'var(--conn-brands)' },
  { label: 'SEC EDGAR', color: 'var(--success)' },
  { label: 'FEC', color: 'var(--gold)' },
  { label: 'OpenCorporates', color: 'var(--conn-customers)' },
]

const cardStyle = {
  background: 'var(--glass-card)',
  border: '1px solid var(--glass-card-border)',
  borderRadius: 'var(--radius-card, 14px)',
  backdropFilter: 'blur(var(--glass-blur, 20px))',
  WebkitBackdropFilter: 'blur(var(--glass-blur, 20px))',
}

const eyebrow = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-2xs)',
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  color: 'var(--text-muted)',
}

// Tricolor logo gradient (indigo → pink → green) for the wordmark.
const wordmark = {
  backgroundImage: 'var(--gradient-logo)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
}

function tint(color, pct) {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

export default function Landing() {
  return (
    <>
      {/* Ambient multi-color glow — indigo, pink, cyan auras over the dark bg */}
      <div
        aria-hidden='true'
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background: `
            radial-gradient(55% 45% at 12% 0%, ${tint('var(--accent)', 20)}, transparent 70%),
            radial-gradient(50% 45% at 88% 8%, ${tint('var(--highlight)', 16)}, transparent 70%),
            radial-gradient(45% 40% at 62% 26%, ${tint('var(--conn-customers)', 12)}, transparent 70%)
          `,
        }}
      />

      <main
        style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: 'var(--content-max, 960px)',
          margin: '0 auto',
          padding: 'var(--space-6) var(--space-5) var(--space-10)',
        }}
      >
        {/* Top bar — wordmark */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            paddingTop: 'var(--space-2)',
            marginBottom: 'var(--space-10)',
          }}
        >
          <span
            style={{
              ...wordmark,
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-2xl)',
              fontWeight: 700,
            }}
          >
            boyk
          </span>
        </header>

        {/* Hero */}
        <section style={{ textAlign: 'center', marginBottom: 'var(--space-12, 72px)' }}>
          <p style={{ ...eyebrow, marginBottom: 'var(--space-4)' }}>
            <span style={{ color: 'var(--conn-customers)' }}>Expose</span>
            {' · '}
            <span style={{ color: 'var(--accent)' }}>Boycott</span>
            {' · '}
            <span style={{ color: 'var(--highlight)' }}>Resist</span>
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(2.5rem, 7vw, 4.5rem)',
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              margin: '0 auto var(--space-5)',
              maxWidth: 720,
            }}
          >
            Follow the money behind the brands you buy.
          </h1>
          <p
            style={{
              fontSize: 'var(--text-xl)',
              lineHeight: 1.5,
              color: 'var(--text-secondary)',
              maxWidth: 620,
              margin: '0 auto var(--space-8)',
            }}
          >
            Boyk is a corporate-ownership and boycott-tracking app, built as a personal project by
            Daniel Freymann. Map who owns what, scan products to their parent companies, and
            organize boycotts backed by sourced data. This site is a read-only demo running on a
            data snapshot from {DEMO_SNAPSHOT_DATE}.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              justifyContent: 'center',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
            }}
          >
            <Link
              to='/explore'
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--text-md)',
                fontWeight: 700,
                color: 'var(--text-on-accent)',
                background: 'var(--gradient-logo)',
                textDecoration: 'none',
                padding: 'var(--space-3-5) var(--space-6)',
                borderRadius: 'var(--radius-full)',
                boxShadow: '0 8px 30px color-mix(in srgb, var(--highlight) 40%, transparent)',
              }}
            >
              Explore the demo
            </Link>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-3)',
              }}
            >
              <a
                href={SOURCE_URL}
                target='_blank'
                rel='noopener noreferrer'
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  fontFamily: 'var(--font-heading)',
                  fontSize: 'var(--text-md)',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  background: 'transparent',
                  padding: 'var(--space-3-5) var(--space-6)',
                  borderRadius: 'var(--radius-full)',
                  border: '1px solid var(--border-strong, var(--border))',
                  textDecoration: 'none',
                }}
              >
                <Github size={18} aria-hidden='true' />
                View the source
              </a>
              <span style={{ ...eyebrow, color: 'var(--accent)' }}>
                Web, iPhone app and data pipeline
              </span>
            </div>
          </div>
        </section>

        {/* Stat band */}
        <section
          aria-label='Knowledge graph scale'
          style={{
            ...cardStyle,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 'var(--space-4)',
            padding: 'var(--space-6)',
            marginBottom: 'var(--space-12, 72px)',
          }}
        >
          {STATS.map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: 'var(--text-3xl)',
                  fontWeight: 700,
                  color: s.color,
                  lineHeight: 1,
                }}
              >
                {s.value}
              </div>
              <div style={{ ...eyebrow, marginTop: 'var(--space-2)' }}>{s.label}</div>
            </div>
          ))}
        </section>

        {/* Features */}
        <section style={{ marginBottom: 'var(--space-12, 72px)' }}>
          <p style={{ ...eyebrow, textAlign: 'center', marginBottom: 'var(--space-2)' }}>
            What you can do
          </p>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-3xl)',
              fontWeight: 700,
              textAlign: 'center',
              margin: '0 0 var(--space-8)',
            }}
          >
            Corporate accountability, in your pocket
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 'var(--space-4)',
            }}
          >
            {FEATURES.map(f => {
              const Icon = f.icon
              return (
                <div
                  key={f.title}
                  style={{
                    ...cardStyle,
                    padding: 'var(--space-6)',
                    position: 'relative',
                    overflow: 'hidden',
                    borderTop: `2px solid ${tint(f.color, 55)}`,
                  }}
                >
                  {/* Per-card colored corner glow */}
                  <div
                    aria-hidden='true'
                    style={{
                      position: 'absolute',
                      top: -50,
                      right: -50,
                      width: 150,
                      height: 150,
                      borderRadius: '50%',
                      background: `radial-gradient(circle, ${tint(f.color, 26)}, transparent 70%)`,
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    style={{
                      position: 'relative',
                      width: 44,
                      height: 44,
                      borderRadius: 'var(--radius-md)',
                      background: tint(f.color, 15),
                      border: `1px solid ${tint(f.color, 35)}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 'var(--space-4)',
                    }}
                  >
                    <Icon size={22} style={{ color: f.color }} />
                  </div>
                  <h3
                    style={{
                      position: 'relative',
                      fontFamily: 'var(--font-heading)',
                      fontSize: 'var(--text-lg)',
                      fontWeight: 600,
                      margin: '0 0 var(--space-2)',
                    }}
                  >
                    {f.title}
                  </h3>
                  <p
                    style={{
                      position: 'relative',
                      color: 'var(--text-secondary)',
                      fontSize: 'var(--text-sm)',
                      lineHeight: 1.55,
                      margin: 0,
                    }}
                  >
                    {f.body}
                  </p>
                </div>
              )
            })}
          </div>
        </section>

        {/* Data provenance strip */}
        <section
          style={{
            ...cardStyle,
            padding: 'var(--space-8)',
            textAlign: 'center',
            marginBottom: 'var(--space-10)',
          }}
        >
          <p style={{ ...eyebrow, marginBottom: 'var(--space-3)' }}>Where the data comes from</p>
          <p
            style={{
              fontSize: 'var(--text-lg)',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              maxWidth: 640,
              margin: '0 auto var(--space-6)',
            }}
          >
            Boyk draws its corporate connections from public sources — the Global LEI Index,
            Wikidata, SEC filings, federal contract and enforcement records, and others — and shows
            the source and confidence behind each connection so you can verify it yourself.
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 'var(--space-2)',
            }}
          >
            {SOURCES.map(src => (
              <span
                key={src.label}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-1-5)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-2xs)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--text-secondary)',
                  padding: 'var(--space-1-5) var(--space-3)',
                  borderRadius: 'var(--radius-full)',
                  background: tint(src.color, 10),
                  border: `1px solid ${tint(src.color, 30)}`,
                }}
              >
                <span
                  aria-hidden='true'
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: src.color,
                    boxShadow: `0 0 8px ${src.color}`,
                  }}
                />
                {src.label}
              </span>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 'var(--space-6)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-4)',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
          }}
        >
          <span>A personal project by Daniel Freymann</span>
          <nav style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
            <Link to='/about' style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
              About this project
            </Link>
            <a
              href={SOURCE_URL}
              target='_blank'
              rel='noopener noreferrer'
              style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
            >
              Source code
            </a>
          </nav>
        </footer>
      </main>
    </>
  )
}
