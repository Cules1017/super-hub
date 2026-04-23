import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Header from './Header.jsx';
import Footer from './Footer.jsx';
import AnnouncementBar from './AnnouncementBar.jsx';
import ParticlesBackground from '../three/ParticlesBackground.jsx';
import MaintenanceScreen from './MaintenanceScreen.jsx';
import { useConfig } from '../../hooks/useConfig.jsx';

export default function Layout() {
  const { get, loading } = useConfig();
  const location = useLocation();
  const maintenance = get('maintenance_mode', false);

  return (
    <div className="relative min-h-screen">
      <ParticlesBackground />
      <AnnouncementBar />
      <Header />
      <main className="mx-auto w-full max-w-7xl px-4 py-6">
        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          </div>
        ) : maintenance ? (
          <MaintenanceScreen />
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        )}
      </main>
      <Footer />
    </div>
  );
}
