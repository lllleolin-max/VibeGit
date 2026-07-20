import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './browser-api'
import { App } from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('VibeGit root element is missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)

document.getElementById('boot-shell')?.remove()
document.documentElement.dataset.vibegitReady = 'true'
