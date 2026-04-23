import { useConfig } from '../../hooks/useConfig.jsx';
import AdsPlaceholder from '../ads/AdsPlaceholder.jsx';

export default function Footer() {
  const { get } = useConfig();
  const siteName = get('site_name', 'Mega Hub');
  return (
    <footer
      className="mt-16 border-t backdrop-blur-xl"
      style={{ borderColor: 'var(--border-color)', background: 'var(--glass-bg)' }}
    >
      <div className="mx-auto max-w-7xl px-4 py-10">
        <AdsPlaceholder slot="footer" label="footer" className="mb-8" />
        <div className="flex flex-col items-center justify-between gap-3 text-sm text-slate-400 md:flex-row">
          <span>© {new Date().getFullYear()} {siteName}. All rights reserved.</span>
          <span className="text-xs">Serverless · Google Sheets · React + Vite</span>
        </div>
      </div>
    </footer>
  );
}
