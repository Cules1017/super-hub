import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import SofaImage from '../common/SofaImage';

function TeamBadge({ name, logo, color = 'from-cyan-400 to-indigo-500' }) {
  if (logo) {
    return (
      <SofaImage
        src={logo}
        alt={name}
        className="h-10 w-10 rounded-full bg-slate-800 object-cover ring-2 ring-white/10"
      />
    );
  }
  return (
    <div
      className={`grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br ${color} text-sm font-black text-slate-900 ring-2 ring-white/10`}
    >
      {String(name || '?').slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function MatchCard({ match, onClick, favoriteTeamIds = [], onToggleFavoriteTeam }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rx = useSpring(useTransform(y, [-40, 40], [8, -8]), { stiffness: 200, damping: 20 });
  const ry = useSpring(useTransform(x, [-40, 40], [-8, 8]), { stiffness: 200, damping: 20 });

  const isLive = String(match.status).toUpperCase() === 'LIVE';
  const isHT = String(match.status).toUpperCase() === 'HT';
  const minute = match.minute || 0;
  const favHome = favoriteTeamIds.includes(String(match.homeId || ''));
  const favAway = favoriteTeamIds.includes(String(match.awayId || ''));

  const handleMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    x.set(e.clientX - r.left - r.width / 2);
    y.set(e.clientY - r.top - r.height / 2);
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.article
      onMouseMove={handleMove}
      onMouseLeave={reset}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 800 }}
      className={`match-card group p-4 ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div
        className={`top-accent ${
          isLive
            ? 'bg-gradient-to-r from-rose-500 via-rose-400 to-orange-400'
            : isHT
            ? 'bg-gradient-to-r from-amber-400 to-amber-300'
            : 'bg-gradient-to-r from-cyan-400 to-indigo-500'
        }`}
      />

      <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
        <span className="flex min-w-0 items-center gap-1.5">
          {match.leagueLogo && (
            <SofaImage
              src={match.leagueLogo}
              alt=""
              className="h-4 w-4 shrink-0 rounded-full bg-slate-100 object-contain p-0.5"
            />
          )}
          <span className="truncate font-bold">
            {match.leagueDisplay || (match.country ? `${match.country} · ${match.league}` : match.league)}
          </span>
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${
            isLive
              ? 'bg-rose-500/20 text-rose-300'
              : isHT
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-slate-500/20 text-slate-300'
          }`}
        >
          {isLive && <span className="live-dot" />}
          {isLive ? `${minute}'` : match.status || '—'}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {/* Home side */}
        <div className="flex min-w-0 items-center gap-3">
          <TeamBadge name={match.home} logo={match.homeLogo} color="from-cyan-400 to-sky-500" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-bold">{match.home}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavoriteTeam?.({ id: match.homeId, name: match.home });
                }}
                className={`text-xs transition ${favHome ? 'text-amber-400' : 'text-slate-500 hover:text-amber-300'}`}
                title="Yêu thích đội nhà"
                aria-label="Favorite home team"
              >
                {favHome ? '★' : '☆'}
              </button>
            </div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Home</div>
          </div>
        </div>

        {/* Scoreboard */}
        <div className="scoreboard flex flex-col items-center gap-0.5 px-3 py-2 min-w-[82px]">
          <div className="flex items-baseline gap-1.5 text-2xl font-black leading-none">
            <span className={isLive ? 'text-rose-300' : 'text-white'}>{match.homeScore ?? 0}</span>
            <span className="text-xs text-white/50">:</span>
            <span className={isLive ? 'text-rose-300' : 'text-white'}>{match.awayScore ?? 0}</span>
          </div>
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/70">
            {isLive ? (
              <span className="inline-flex items-center gap-1 text-rose-200">
                <span className="live-dot" /> Live
              </span>
            ) : isHT ? (
              <span className="text-amber-200">Nghỉ giữa</span>
            ) : (
              String(match.status || '—')
            )}
          </div>
        </div>

        {/* Away side */}
        <div className="flex min-w-0 items-center justify-end gap-3">
          <div className="min-w-0 text-right">
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavoriteTeam?.({ id: match.awayId, name: match.away });
                }}
                className={`text-xs transition ${favAway ? 'text-amber-400' : 'text-slate-500 hover:text-amber-300'}`}
                title="Yêu thích đội khách"
                aria-label="Favorite away team"
              >
                {favAway ? '★' : '☆'}
              </button>
              <span className="truncate text-sm font-bold">{match.away}</span>
            </div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Away</div>
          </div>
          <TeamBadge name={match.away} logo={match.awayLogo} color="from-rose-400 to-red-500" />
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(400px 200px at var(--mx,50%) var(--my,50%), rgba(34,211,238,0.12), transparent 60%)',
        }}
      />
    </motion.article>
  );
}
