import React from 'react';
import ReactDOM from 'react-dom/client';
import GestaoOrganizacionalPage from './components/GestaoOrganizacionalPage.jsx';

const root = document.getElementById('root');
if (root) {
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <GestaoOrganizacionalPage />
        </React.StrictMode>
    );
}
