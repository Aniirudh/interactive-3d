import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// No StrictMode: its double-mounted effects would load and start the character twice.
createRoot(document.getElementById('root')!).render(<App />)
