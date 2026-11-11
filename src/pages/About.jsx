/**
 * @component About
 * @level Page
 * @interactions Explains that the site is a read-only demo of a personal
 *               project, what is and isn't live, and links to the source.
 *               Sign-in, messaging and settings routes land here in demo mode.
 */
import { Github } from 'lucide-react'
import { Link } from 'react-router-dom'

import Header from '../components/organisms/Header'
import { DEMO_SNAPSHOT_DATE, SOURCE_URL } from '../lib/demo'

const BUILT_WITH = [
  [
    'Ownership graph',
    'Neo4j, filled nightly by a Python pipeline from GLEIF, Wikidata, SEC and other public records',
  ],
  [
    'Barcode lookup',
    'An index of about 3 million barcodes built from Open Food Facts and USDA data',
  ],
  [
    'Web app',
    'React, Vite and Tailwind on Cloudflare Pages, with a caching Worker in front of the API',
  ],
  ['iPhone app', 'SwiftUI, shipped through TestFlight'],
  ['Accounts and social features', 'Supabase (Postgres) with row-level security'],
]

const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-xl)',
  padding: 'var(--space-5)',
  marginBottom: 'var(--space-4)',
}

const heading = {
  fontFamily: 'var(--font-heading)',
  fontSize: 'var(--text-lg)',
  fontWeight: 700,
  margin: '0 0 var(--space-2)',
}

const body = {
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-md)',
  lineHeight: 1.6,
  margin: 0,
}

export default function About() {
  return (
    <div className='container'>
      <Header pageLabel='About' />
      <section style={{ paddingTop: 'var(--space-6)' }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-3xl)',
            fontWeight: 700,
            margin: '0 0 var(--space-2)',
          }}
        >
          About this project
        </h1>
        <p style={{ ...body, marginBottom: 'var(--space-5)' }}>
          Boyk is a personal project by Daniel Freymann. It shows who owns the brands you buy, all
          the way up the ownership chain, and lets people organize boycotts around that information.
        </p>

        <div style={card}>
          <h2 style={heading}>This is a read-only demo</h2>
          <p style={body}>
            The site runs from a saved snapshot taken in {DEMO_SNAPSHOT_DATE}, with no database
            behind it. Company, brand, product and people pages come from the real ownership graph
            as it stood then. The accounts, posts and boycotts are sample data. Signing in, posting,
            following and messaging are turned off.
          </p>
        </div>

        <div style={card}>
          <h2 style={heading}>How it was built</h2>
          <dl style={{ margin: 0 }}>
            {BUILT_WITH.map(([term, detail]) => (
              <div key={term} style={{ marginTop: 'var(--space-3)' }}>
                <dt style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{term}</dt>
                <dd style={{ ...body, fontSize: 'var(--text-base)' }}>{detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <a
            href={SOURCE_URL}
            target='_blank'
            rel='noopener noreferrer'
            className='btn-primary'
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              textDecoration: 'none',
            }}
          >
            <Github size={18} aria-hidden='true' />
            View the source
          </a>
          <Link to='/explore' className='btn-secondary' style={{ textDecoration: 'none' }}>
            Explore the demo
          </Link>
        </div>
      </section>
    </div>
  )
}
