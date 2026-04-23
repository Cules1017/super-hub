import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useConfig } from '../hooks/useConfig.jsx';
import AdsPlaceholder from '../components/ads/AdsPlaceholder.jsx';
import SEO from '../components/ui/SEO.jsx';

const modules = [
  {
    to: '/sport',
    title: 'Sport Hub',
    desc: 'Live Score, thống kê bóng đá các giải đấu hàng đầu, cập nhật 60s/lần.',
    emoji: '⚽',
    color: 'from-cyan-400 to-indigo-500',
  },
  {
    to: '#',
    title: 'Tools (sắp có)',
    desc: 'Chuyển đổi đơn vị, tính toán, random utilities...',
    emoji: '🧰',
    color: 'from-amber-400 to-rose-500',
  },
  {
    to: '#',
    title: 'Blog & News (sắp có)',
    desc: 'Nhận định, phân tích, tin tức thể thao, công nghệ.',
    emoji: '📰',
    color: 'from-emerald-400 to-teal-500',
  },
];

export default function HomePage() {
  const { get } = useConfig();

  return (
    <div className="space-y-10">
      <SEO />

      <section className="glass relative overflow-hidden p-8 md:p-14">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-3xl"
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-300 ring-1 ring-cyan-400/30">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
            Serverless · Google Sheets Powered
          </span>
          <h1 className="mt-4 text-4xl font-black tracking-tight md:text-6xl">
            {get('site_name', 'Mega Hub')}
          </h1>
          <p className="mt-3 text-lg text-slate-300 md:text-xl">
            {get('site_tagline', 'Đa tiện ích – Siêu tốc độ')}
          </p>
          <p className="mt-4 max-w-2xl text-sm text-slate-400">
            {get(
              'meta_description',
              'Nền tảng đa tiện ích với kiến trúc serverless. Cấu hình toàn bộ từ Google Sheets, không cần máy chủ.'
            )}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/sport" className="btn-primary">
              Vào Sport Hub →
            </Link>
            <a
              href="#modules"
              className="btn-ghost"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('modules')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              Khám phá tiện ích
            </a>
          </div>
        </motion.div>
      </section>

      <AdsPlaceholder slot="header" label="header" />

      <section id="modules">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-300">
          Các module
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {modules.map((m, i) => (
            <motion.div
              key={m.title}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
            >
              <Link
                to={m.to}
                className="glass block h-full p-5 transition hover:-translate-y-1 hover:shadow-glow"
              >
                <div
                  className={`mb-3 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${m.color} text-xl text-slate-900`}
                >
                  {m.emoji}
                </div>
                <div className="text-lg font-bold">{m.title}</div>
                <p className="mt-1 text-sm text-slate-400">{m.desc}</p>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
