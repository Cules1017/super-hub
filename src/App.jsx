import { Routes, Route } from 'react-router-dom';
import { ConfigProvider } from './hooks/useConfig.jsx';
import Layout from './components/layout/Layout.jsx';
import HomePage from './pages/HomePage.jsx';
import SportHub from './pages/SportHub.jsx';
import AdminLogin from './pages/AdminLogin.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import NotFound from './pages/NotFound.jsx';

export default function App() {
  return (
    <ConfigProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/sport" element={<SportHub />} />
          <Route path="/secret-admin" element={<AdminLogin />} />
          <Route path="/secret-admin/panel" element={<AdminPanel />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ConfigProvider>
  );
}
