import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { AuthProvider } from './lib/auth'
import App from './App'
import DemoBanner from './components/DemoBanner'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DemoBanner />
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
