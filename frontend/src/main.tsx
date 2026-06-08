import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './context/ThemeContext.tsx'
import { CopilotProvider } from './ai/context/CopilotProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <CopilotProvider>
        <App />
      </CopilotProvider>
    </ThemeProvider>
  </StrictMode>,
)
