import { AnimatePresence, motion } from 'framer-motion';
import { useConfig } from '../../hooks/useConfig.jsx';

export default function AnnouncementBar() {
  const { get } = useConfig();
  const enabled = get('announcement_enabled', false);
  const text = get('announcement', '');

  return (
    <AnimatePresence>
      {enabled && text && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="relative overflow-hidden border-b border-white/10 bg-gradient-to-r from-cyan-500/20 via-indigo-500/20 to-pink-500/20"
        >
          <div className="mx-auto max-w-7xl px-4 py-2 text-center text-sm text-slate-100">
            {text}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
