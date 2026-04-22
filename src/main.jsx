import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { registerImageCacheWorker } from '@/lib/service-worker'

registerImageCacheWorker()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
