import { Download, Puzzle } from 'lucide-react'

import Header from '../components/organisms/Header'

const EXTENSION_URL = 'https://cdn.boyk.org/extensions/boyk-extension.zip'

export default function Extension() {
  return (
    <div className='container'>
      <Header pageLabel='Chrome Extension' />

      <div style={{ padding: '0 0 100px', maxWidth: '500px', margin: '0 auto' }}>
        {/* Hero */}
        <div
          style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-5) var(--space-6)' }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 'var(--radius-full)',
              background: 'var(--bg-elevated)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto var(--space-4)',
            }}
          >
            <Puzzle size={32} style={{ color: 'var(--accent)' }} />
          </div>
          <h1
            style={{
              fontSize: 'var(--text-3xl)',
              fontWeight: 'var(--font-semibold)',
              marginBottom: 'var(--space-2)',
            }}
          >
            Boyk for Chrome
          </h1>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--text-md)',
              lineHeight: 'var(--leading-normal)',
            }}
          >
            Check companies while you browse. The extension flags boycotted products on any website.
          </p>
        </div>

        {/* Download button */}
        <div style={{ padding: '0 var(--space-5)', marginBottom: 'var(--space-8)' }}>
          <a
            href={EXTENSION_URL}
            download='boyk-extension.zip'
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2-5)',
              width: '100%',
              padding: 'var(--space-3-5) var(--space-6)',
              background: 'var(--gradient-accent)',
              color: 'var(--text-on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-lg)',
              fontSize: 15,
              fontWeight: 'var(--font-semibold)',
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            <Download size={18} />
            Download Extension
          </a>
        </div>

        {/* Install instructions */}
        <div style={{ padding: '0 var(--space-5)' }}>
          <h2
            style={{
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--font-semibold)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              color: 'var(--text-muted)',
              marginBottom: 'var(--space-4)',
            }}
          >
            Installation Steps
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {[
              {
                step: 1,
                title: 'Download & unzip',
                desc: 'Click the button above to download the .zip file, then unzip it to a folder on your computer.',
              },
              {
                step: 2,
                title: 'Open Chrome extensions',
                desc: (
                  <>
                    Go to{' '}
                    <code
                      style={{
                        background: 'var(--bg-dark)',
                        padding: 'var(--space-0-5) var(--space-1-5)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--text-sm)',
                      }}
                    >
                      chrome://extensions
                    </code>{' '}
                    in your browser, or click the puzzle icon and select &ldquo;Manage
                    Extensions&rdquo;.
                  </>
                ),
              },
              {
                step: 3,
                title: 'Enable Developer Mode',
                desc: 'Toggle the "Developer mode" switch in the top-right corner of the extensions page.',
              },
              {
                step: 4,
                title: 'Load the extension',
                desc: 'Click "Load unpacked" and select the unzipped folder. The Boyk icon should appear in your toolbar.',
              },
              {
                step: 5,
                title: 'Pin it',
                desc: 'Click the puzzle icon in Chrome and pin Boyk for easy access.',
              },
            ].map(({ step, title, desc }) => (
              <div
                key={step}
                style={{
                  display: 'flex',
                  gap: 'var(--space-3-5)',
                  padding: 'var(--space-4)',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--accent)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'var(--text-base)',
                    fontWeight: 'var(--font-bold)',
                    flexShrink: 0,
                  }}
                >
                  {step}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 'var(--font-semibold)',
                      fontSize: 'var(--text-md)',
                      marginBottom: 'var(--space-1)',
                    }}
                  >
                    {title}
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--text-base)',
                      color: 'var(--text-muted)',
                      lineHeight: 'var(--leading-normal)',
                    }}
                  >
                    {desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
