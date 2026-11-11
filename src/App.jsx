import React, { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import BoykLogoLoader from './components/molecules/BoykLogoLoader'
import BottomNav from './components/organisms/BottomNav'
import DemoFeedbackBanner from './components/organisms/DemoFeedbackBanner'
import ErrorBoundary from './components/organisms/ErrorBoundary'
import { ToastProvider } from './components/organisms/Toast'
import UsernameGate from './components/organisms/UsernameGate'
import { AppProvider } from './context/AppContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { usePageTracking } from './hooks/usePageTracking'
import { usePaperPreview } from './hooks/usePaperPreview'
import { DEMO_MODE, DEMO_SNAPSHOT_DATE } from './lib/demo'

// Lazy load pages for code splitting
const Home = lazy(() => import('./pages/Home'))
const Explore = lazy(() => import('./pages/Explore'))
const CheckProduct = lazy(() => import('./pages/CheckProduct'))
const Auth = lazy(() => import('./pages/Auth'))
const Profile = lazy(() => import('./pages/Profile'))
const Company = lazy(() => import('./pages/Company'))
const Network = lazy(() => import('./pages/Network'))
const Spending = lazy(() => import('./pages/Spending'))
const Feedback = lazy(() => import('./pages/Feedback'))
const Settings = lazy(() => import('./pages/Settings'))
const Extension = lazy(() => import('./pages/Extension'))
const Brand = lazy(() => import('./pages/Brand'))
const Person = lazy(() => import('./pages/Person'))
const Feed = lazy(() => import('./pages/Feed'))
const PostPage = lazy(() => import('./pages/PostPage'))
const BoycottPage = lazy(() => import('./pages/BoycottPage'))
const NotFound = lazy(() => import('./pages/NotFound'))
const IOSDemo = lazy(() => import('./pages/IOSDemo'))
const Messages = lazy(() => import('./pages/Messages'))
const DemoLanding = lazy(() => import('./pages/DemoLanding'))
const Landing = lazy(() => import('./pages/Landing'))
const About = lazy(() => import('./pages/About'))
const Legal = lazy(() => import('./pages/Legal'))
const LogoDemo = lazy(() => import('./pages/LogoDemo'))

// Loading fallback — the branded loader runs inside a 50vh region so it sits
// in content flow rather than blacking out the whole viewport on every route
// transition. Switch `fullScreen` to true for a true splash treatment.
// After `timeoutMs` of continuous loading it surfaces a stall notice with a
// Reload action so a failed chunk fetch never dead-ends on a bare splash.
function SplashWithTimeout({ timeoutMs = 10000 }) {
  const [timedOut, setTimedOut] = React.useState(false)

  React.useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), timeoutMs)
    return () => clearTimeout(timer)
  }, [timeoutMs])

  return (
    <div
      style={{
        position: 'relative',
        height: '50vh',
      }}
    >
      <BoykLogoLoader size={180} fullScreen={false} />
      {timedOut && (
        <div
          role='status'
          aria-live='polite'
          style={{
            position: 'absolute',
            bottom: 'var(--space-6)',
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: '0 var(--space-5)',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              margin: 0,
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            Still loading… check your connection
          </p>
          <button type='button' className='btn-primary' onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
    </div>
  )
}

// Ambient background component - works with both light and dark themes
function AmbientBackground() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: -1,
        background: `
          radial-gradient(ellipse 80% 50% at 20% -10%, rgba(244,114,182,0.12) 0%, transparent 50%),
          radial-gradient(ellipse 60% 40% at 85% -5%, rgba(244,114,182,0.08) 0%, transparent 50%),
          radial-gradient(ellipse 60% 40% at 50% 110%, rgba(52,211,153,0.08) 0%, transparent 50%),
          radial-gradient(ellipse 100% 80% at 50% 50%, transparent 40%, var(--bg-dark) 100%),
          var(--bg-dark)
        `,
      }}
    />
  )
}

function ScrollToTop() {
  const { pathname } = useLocation()
  const prevPath = React.useRef(pathname)

  React.useEffect(() => {
    // Don't scroll on feed (preserves scroll position via scrollPositionRef)
    if (pathname !== '/feed' && pathname !== prevPath.current) {
      window.scrollTo(0, 0)
    }
    prevPath.current = pathname
  }, [pathname])

  return null
}

function AppContent() {
  const { loading, user } = useAuth()
  const location = useLocation()
  usePageTracking()
  usePaperPreview()

  // Auth screens and the public landing ('/' when logged out) are standalone in
  // the design — no dock, no disclaimer footer (they carry their own chrome).
  const isAuthRoute =
    location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/'

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100dvh',
        }}
      >
        <div className='spinner'></div>
      </div>
    )
  }

  return (
    <ToastProvider>
      <AppProvider>
        <ScrollToTop />
        <AmbientBackground />
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<SplashWithTimeout />}>
            <Routes>
              <Route path='/' element={user ? <Navigate to='/feed' replace /> : <Landing />} />
              <Route path='/home' element={<Home />} />
              <Route path='/explore' element={<Explore />} />
              <Route path='/feed' element={<Feed />} />
              <Route path='/post/:postId' element={<PostPage />} />
              <Route path='/boycott/:boycottId' element={<BoycottPage />} />
              <Route path='/check' element={<CheckProduct />} />
              <Route path='/about' element={<About />} />
              {/* The demo has no accounts: anything that needs one explains why. */}
              {DEMO_MODE &&
                ['/login', '/signup', '/messages', '/spending', '/feedback', '/settings'].map(
                  path => (
                    <Route key={path} path={path} element={<Navigate to='/about' replace />} />
                  )
                )}
              <Route path='/login' element={<Auth mode='login' />} />
              <Route path='/signup' element={<Auth mode='signup' />} />
              <Route path='/user/:userId' element={<Profile />} />
              <Route path='/company/:companyId' element={<Company />} />
              <Route path='/brand/:brandId' element={<Brand />} />
              <Route path='/person/:personId' element={<Person />} />
              <Route path='/network' element={<Network />} />
              <Route path='/messages' element={<Messages />} />
              <Route path='/spending' element={<Spending />} />
              <Route path='/feedback' element={<Feedback />} />
              <Route path='/settings' element={<Settings />} />
              <Route path='/logo' element={<LogoDemo />} />
              <Route path='/extension' element={<Extension />} />
              <Route path='*' element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
        {!isAuthRoute && (
          <footer
            style={{
              padding: 'var(--space-6) var(--space-5) calc(var(--space-6) + 80px)',
              textAlign: 'center',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
              lineHeight: 1.5,
              maxWidth: 480,
              margin: '0 auto',
            }}
          >
            {DEMO_MODE && (
              <div style={{ marginBottom: 'var(--space-2)' }}>
                Read-only demo with sample accounts · data snapshot from {DEMO_SNAPSHOT_DATE} ·{' '}
                <Link to='/about' style={{ color: 'inherit' }}>
                  About this project
                </Link>
              </div>
            )}
            Boyk draws its corporate connections data from a range of online sources, which may
            contain inaccuracies.
            {/* Required by logo.dev's free plan, which company logos are hotlinked from */}
            <div style={{ marginTop: 'var(--space-2)' }}>
              <a
                href='https://logo.dev'
                target='_blank'
                rel='noopener noreferrer'
                style={{ color: 'inherit' }}
              >
                Logos provided by Logo.dev
              </a>
            </div>
          </footer>
        )}
        {!isAuthRoute && <BottomNav />}
        <UsernameGate />
        <DemoFeedbackBanner />
      </AppProvider>
    </ToastProvider>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path='/ios'
          element={
            DEMO_MODE ? (
              <Navigate to='/' replace />
            ) : (
              <Suspense fallback={<SplashWithTimeout />}>
                <IOSDemo />
              </Suspense>
            )
          }
        />
        <Route
          path='/demo'
          element={
            DEMO_MODE ? (
              <Navigate to='/about' replace />
            ) : (
              <Suspense fallback={<SplashWithTimeout />}>
                <DemoLanding />
              </Suspense>
            )
          }
        />
        <Route
          path='/terms'
          element={
            DEMO_MODE ? (
              <Navigate to='/about' replace />
            ) : (
              <Suspense fallback={<SplashWithTimeout />}>
                <Legal />
              </Suspense>
            )
          }
        />
        <Route
          path='/privacy'
          element={
            DEMO_MODE ? (
              <Navigate to='/about' replace />
            ) : (
              <Suspense fallback={<SplashWithTimeout />}>
                <Legal />
              </Suspense>
            )
          }
        />
        <Route
          path='*'
          element={
            <ThemeProvider>
              <AuthProvider>
                <AppContent />
              </AuthProvider>
            </ThemeProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
