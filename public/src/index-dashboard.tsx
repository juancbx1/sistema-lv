import React from 'react';
import ReactDOM from 'react-dom/client';
import MainDashboard from './main-dashboard';

const rootElement = document.getElementById('root-dashboard');

if (rootElement) {
    ReactDOM.createRoot(rootElement).render(
        <React.StrictMode>
            <MainDashboard />
        </React.StrictMode>,
    );
}
