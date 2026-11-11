/**
 * @component BarcodeScanner
 * @level Organism
 * @interactions Reads barcodes from camera/image upload, queries Neo4j product database, checks boycott status.
 */
import Quagga from '@ericblade/quagga2'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Camera, CheckCircle, Loader2, Package, ScanLine, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useApp } from '../../context/AppContext'
import { trackEvent } from '../../lib/analytics'
import { getProductByBarcode } from '../../services/neo4jGraph'

export default function BarcodeScanner({ onProductFound, onClose, initialFile }) {
  const { boycotts } = useApp()
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const fileInputRef = useRef(null)
  const initialFileProcessed = useRef(false)

  // Look up product by barcode in Neo4j database
  const lookupProduct = useCallback(
    async barcode => {
      try {
        const product = await getProductByBarcode(barcode)

        if (!product) {
          return { barcode, product: null, notFound: true }
        }

        // Map flat API fields to structured objects for display
        const brand = product.brand_name ? { name: product.brand_name, id: product.brand_id } : null
        const company = product.company_name
          ? { name: product.company_name, id: product.company_id, logo: product.company_logo }
          : null

        // Check if product's company is in any active boycott
        const activeBoycottCompanyIds = new Set(
          boycotts?.filter(b => b.is_active)?.flatMap(b => b.companies?.map(c => c.id) || []) || []
        )
        const isBoycotted = company && activeBoycottCompanyIds.has(company.id)

        return {
          barcode,
          product,
          brand,
          company,
          isBoycotted,
          notFound: false,
        }
      } catch (err) {
        console.error('Product lookup error:', err)
        return { barcode, product: null, notFound: true }
      }
    },
    [boycotts]
  )

  const processImage = useCallback(
    async imageSrc => {
      setScanning(true)
      setError(null)
      setResult(null)

      try {
        const result = await Promise.race([
          new Promise((resolve, reject) => {
            Quagga.decodeSingle(
              {
                src: imageSrc,
                numOfWorkers: 0,
                locate: true,
                decoder: {
                  readers: [
                    'ean_reader',
                    'ean_8_reader',
                    'upc_reader',
                    'upc_e_reader',
                    'code_128_reader',
                    'code_39_reader',
                  ],
                },
              },
              res => {
                if (res?.codeResult?.code) {
                  resolve(res.codeResult.code)
                } else {
                  reject(new Error('No barcode found in image'))
                }
              }
            )
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Scan timed out')), 15000)),
        ])

        trackEvent('product_scanned', { barcode: result })
        const lookupResult = await lookupProduct(result)
        setResult(lookupResult)

        if (onProductFound && lookupResult.product) {
          onProductFound(lookupResult)
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setScanning(false)
      }
    },
    [lookupProduct, onProductFound]
  )

  const handleFileSelect = useCallback(
    e => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = event => {
        const imageSrc = event.target?.result
        setImagePreview(imageSrc)
        processImage(imageSrc)
      }
      reader.readAsDataURL(file)
    },
    [processImage]
  )

  const handleDrop = useCallback(
    e => {
      e.preventDefault()
      const file = e.dataTransfer?.files?.[0]
      if (!file?.type.startsWith('image/')) return

      const reader = new FileReader()
      reader.onload = event => {
        const imageSrc = event.target?.result
        setImagePreview(imageSrc)
        processImage(imageSrc)
      }
      reader.readAsDataURL(file)
    },
    [processImage]
  )

  const reset = () => {
    setResult(null)
    setError(null)
    setImagePreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  useEffect(() => {
    if (initialFile && !initialFileProcessed.current) {
      initialFileProcessed.current = true
      const reader = new FileReader()
      reader.onload = event => {
        const imageSrc = event.target?.result
        setImagePreview(imageSrc)
        processImage(imageSrc)
      }
      reader.readAsDataURL(initialFile)
    }
  }, [initialFile, processImage])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4'
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className='card-primary w-full max-w-md relative p-6'
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className='absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 transition-colors z-10'
          aria-label='Close'
        >
          <X className='w-5 h-5' />
        </button>
        <div className='mb-6'>
          <h2 className='section-title flex items-center gap-2'>
            <ScanLine className='w-5 h-5 text-accent' />
            Scan Barcode
          </h2>
        </div>

        <input
          ref={fileInputRef}
          type='file'
          accept='image/*'
          capture='environment'
          onChange={handleFileSelect}
          className='hidden'
        />

        <AnimatePresence mode='wait'>
          {!imagePreview && !result && (
            <motion.div
              key='upload'
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className='flex flex-col gap-6'
            >
              <div
                role='button'
                tabIndex={0}
                className='relative w-full h-64 mx-auto rounded-2xl overflow-hidden bg-black/20 border border-white/10 flex flex-col items-center justify-center cursor-pointer hover:bg-black/40 hover:border-accent/50 transition-all duration-300 group shadow-inner'
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    fileInputRef.current?.click()
                  }
                }}
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
              >
                {/* Scanner frame corners */}
                <div className='absolute top-6 left-6 w-10 h-10 border-t-2 border-l-2 border-accent/40 rounded-tl-xl transition-all duration-300 group-hover:border-accent group-hover:scale-110 origin-top-left group-hover:shadow-[inset_4px_4px_10px_rgba(220,38,38,0.2)]' />
                <div className='absolute top-6 right-6 w-10 h-10 border-t-2 border-r-2 border-accent/40 rounded-tr-xl transition-all duration-300 group-hover:border-accent group-hover:scale-110 origin-top-right group-hover:shadow-[inset_-4px_4px_10px_rgba(220,38,38,0.2)]' />
                <div className='absolute bottom-6 left-6 w-10 h-10 border-b-2 border-l-2 border-accent/40 rounded-bl-xl transition-all duration-300 group-hover:border-accent group-hover:scale-110 origin-bottom-left group-hover:shadow-[inset_4px_-4px_10px_rgba(220,38,38,0.2)]' />
                <div className='absolute bottom-6 right-6 w-10 h-10 border-b-2 border-r-2 border-accent/40 rounded-br-xl transition-all duration-300 group-hover:border-accent group-hover:scale-110 origin-bottom-right group-hover:shadow-[inset_-4px_-4px_10px_rgba(220,38,38,0.2)]' />

                <div className='w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mb-4 group-hover:bg-accent/20 group-hover:shadow-[0_0_20px_rgba(220,38,38,0.3)] transition-all duration-300'>
                  <Camera className='w-7 h-7 text-accent group-hover:scale-110 transition-transform duration-300' />
                </div>
                <p className='text-text-primary font-semibold text-lg tracking-wide'>
                  Click to upload barcode
                </p>
              </div>
            </motion.div>
          )}

          {imagePreview && scanning && (
            <motion.div
              key='scanning'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className='text-center py-8'
            >
              <div className='relative w-full aspect-video rounded-2xl overflow-hidden mb-6 border border-white/10 shadow-lg'>
                <img
                  src={imagePreview}
                  alt='Scanning'
                  className='w-full h-full object-contain bg-black/60 backdrop-blur-sm'
                />
                <div className='absolute inset-0 flex items-center justify-center bg-black/40'>
                  <motion.div
                    animate={{ y: [-60, 60] }}
                    transition={{
                      repeat: Infinity,
                      repeatType: 'reverse',
                      duration: 1.5,
                      ease: 'easeInOut',
                    }}
                    className='w-full h-1 bg-accent shadow-[0_0_20px_rgba(220,38,38,0.8)] relative'
                  >
                    <div className='absolute inset-0 bg-white/50 blur-[2px]' />
                  </motion.div>
                </div>
              </div>
              <div className='flex items-center justify-center gap-3 text-text-primary font-medium bg-bg-dark/50 py-3 px-6 rounded-full inline-flex mx-auto border border-white/5'>
                <Loader2 className='w-5 h-5 animate-spin text-accent' />
                <span className='tracking-wide'>Analyzing barcode...</span>
              </div>
            </motion.div>
          )}

          {error && (
            <motion.div
              key='error'
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className='text-center py-6'
            >
              {imagePreview && (
                <div className='w-full aspect-video rounded-2xl overflow-hidden mb-6 border border-white/10 shadow-lg'>
                  <img
                    src={imagePreview}
                    alt='Scanned'
                    className='w-full h-full object-contain bg-black/60 backdrop-blur-sm'
                  />
                </div>
              )}
              <div className='flex flex-col items-center justify-center gap-3 text-danger mb-8 bg-danger/10 p-6 rounded-2xl border border-danger/20'>
                <AlertTriangle className='w-10 h-10' />
                <span className='font-medium text-center'>{error}</span>
              </div>
              <button onClick={reset} className='btn-secondary w-full py-3 text-base'>
                Try Again
              </button>
            </motion.div>
          )}

          {result && (
            <motion.div
              key='result'
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {imagePreview && (
                <div className='w-full aspect-video rounded-2xl overflow-hidden mb-6 border border-white/10 shadow-lg'>
                  <img
                    src={imagePreview}
                    alt='Scanned'
                    className='w-full h-full object-contain bg-black/60 backdrop-blur-sm'
                  />
                </div>
              )}

              <div className='bg-bg-dark/80 backdrop-blur-md rounded-2xl p-5 mb-6 border border-white/5 shadow-inner flex items-center justify-between'>
                <div className='text-text-muted text-xs uppercase tracking-wider font-semibold'>
                  Barcode
                </div>
                <div className='font-mono text-xl text-text-primary tracking-widest'>
                  {result.barcode}
                </div>
              </div>

              {result.notFound && (
                <div className='text-center py-8 bg-bg-dark/30 rounded-2xl border border-white/5 mb-6'>
                  <Package className='w-16 h-16 text-text-muted/50 mx-auto mb-4' />
                  <p className='text-text-primary font-medium text-lg'>Product not found</p>
                  <p className='text-text-muted text-sm mt-2 max-w-[250px] mx-auto'>
                    This barcode isn&apos;t in our product database yet.
                  </p>
                </div>
              )}

              {result.product && (
                <>
                  {result.product.recalled && (
                    <div className='rounded-2xl p-5 bg-danger/10 border border-danger/40 mb-4 shadow-[0_4px_20px_rgba(239,68,68,0.15)] relative overflow-hidden'>
                      <div className='absolute top-0 left-0 w-1 h-full bg-danger' />
                      <div className='flex items-start gap-4'>
                        <div className='bg-danger/20 p-2 rounded-full'>
                          <AlertTriangle className='w-6 h-6 text-danger flex-shrink-0' />
                        </div>
                        <div className='flex-1 min-w-0 pt-0.5'>
                          <div className='font-bold text-danger text-sm uppercase tracking-wider mb-1'>
                            Product Recalled
                          </div>
                          {result.product.recall_reason && (
                            <div className='text-text-primary text-sm leading-relaxed'>
                              {result.product.recall_reason}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  <div
                    className={`rounded-2xl p-6 relative overflow-hidden transition-all duration-300 ${
                      result.isBoycotted
                        ? 'bg-gradient-to-br from-danger/10 to-bg-card border border-danger/30 shadow-[0_8px_30px_rgba(239,68,68,0.15)]'
                        : 'bg-gradient-to-br from-success/10 to-bg-card border border-success/30 shadow-[0_8px_30px_rgba(34,197,94,0.15)]'
                    }`}
                  >
                    {/* Status indicator line */}
                    <div
                      className={`absolute top-0 left-0 w-full h-1 ${result.isBoycotted ? 'bg-danger shadow-[0_0_10px_rgba(239,68,68,0.8)]' : 'bg-success shadow-[0_0_10px_rgba(34,197,94,0.8)]'}`}
                    />

                    <div className='flex items-start gap-5'>
                      <div
                        className={`p-3 rounded-2xl flex-shrink-0 ${result.isBoycotted ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'}`}
                      >
                        {result.isBoycotted ? (
                          <AlertTriangle className='w-8 h-8' />
                        ) : (
                          <CheckCircle className='w-8 h-8' />
                        )}
                      </div>
                      <div className='flex-1 min-w-0 pt-1'>
                        <div
                          className={`font-bold text-sm tracking-widest uppercase mb-2 ${
                            result.isBoycotted ? 'text-danger' : 'text-success'
                          }`}
                        >
                          {result.isBoycotted ? 'BOYCOTTED' : 'CLEAR'}
                        </div>
                        <div className='text-text-primary font-bold text-xl leading-tight mb-3'>
                          {result.product.name}
                        </div>

                        <div className='space-y-2 bg-black/20 rounded-xl p-4 border border-white/5'>
                          {result.product.category && (
                            <div className='flex justify-between items-center text-sm'>
                              <span className='text-text-muted'>Category</span>
                              <span className='text-text-primary font-medium text-right'>
                                {result.product.category}
                              </span>
                            </div>
                          )}
                          {result.brand && (
                            <div className='flex justify-between items-center text-sm'>
                              <span className='text-text-muted'>Brand</span>
                              <span className='text-text-primary font-medium text-right'>
                                {result.brand.name}
                              </span>
                            </div>
                          )}
                          {result.company && (
                            <div className='flex justify-between items-center text-sm pt-2 mt-2 border-t border-white/5'>
                              <span className='text-text-muted'>Owner</span>
                              <span className='text-text-primary font-bold text-right'>
                                {result.company.name}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <button onClick={reset} className='btn-primary w-full mt-6 py-4 text-base shadow-lg'>
                Scan Another Product
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}
