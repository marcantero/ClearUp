import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const savedTheme = localStorage.getItem("clearcut-theme") ?? "dark";

document.documentElement.classList.toggle(
  "dark",
  savedTheme === "dark"
);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);