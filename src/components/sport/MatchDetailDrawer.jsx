import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { apiFetchMatchDetail, apiFetchTeamOverview } from '../../config/api.js';

export default function MatchDetailDrawer({ match, onClose }) {
  const [tab, setTab] = useState('lineup');
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (!match) return;
    const ac = new AbortController();
    setLoading(true);
    setError('');
    setDetail(null);
    apiFetchMatchDetail(match.id, ac.signal, match.status)
      .then(setDetail)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(String(err.message || err));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [match]);

  return (
    <AnimatePresence>
      {match && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />
          <motion.aside
            key="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className="fixed right-0 top-0 z-50 h-full w-full overflow-y-auto border-l border-white/10 bg-slate-950/95 backdrop-blur-xl md:w-[620px]"
          >
            <Header match={match} onClose={onClose} onTeamClick={setSelectedTeam} />

            <div className="sticky top-0 z-10 flex gap-1 border-b border-white/10 bg-slate-950/80 px-4 py-2 backdrop-blur-xl">
              {['lineup', 'stats', 'events', 'standings'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    tab === t ? 'bg-cyan-400 text-slate-900' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {t === 'lineup' ? 'Đội hình' : t === 'stats' ? 'Thống kê' : t === 'events' ? 'Diễn biến' : 'BXH'}
                </button>
              ))}
            </div>

            <div className="p-4">
              {loading && <Skeleton />}
              {error && (
                <div className="rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-sm text-red-200">
                  Lỗi tải chi tiết: {error}
                </div>
              )}
              {!loading && !error && detail && (
                <>
                  {tab === 'lineup' && <LineupView lineup={detail.lineup} match={match} />}
                  {tab === 'stats' && <StatsView stats={detail.stats} match={match} />}
                  {tab === 'events' && <EventsView incidents={detail.incidents} match={match} />}
                  {tab === 'standings' && (
                    <StandingsView standings={detail.standings} match={match} onTeamClick={setSelectedTeam} />
                  )}
                </>
              )}
            </div>
          </motion.aside>
          <TeamQuickDrawer
            team={selectedTeam}
            tournamentId={match?.tournamentId}
            seasonId={match?.seasonId}
            onClose={() => setSelectedTeam(null)}
          />
        </>
      )}
    </AnimatePresence>
  );
}

function Header({ match, onClose, onTeamClick }) {
  return (
    <div className="sticky top-0 z-20 border-b border-white/10 bg-gradient-to-b from-slate-950/95 to-slate-900/70 p-5 backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400">
          {match.leagueLogo && (
            <img src={match.leagueLogo} alt="" className="h-5 w-5 rounded-full bg-slate-800 object-contain" />
          )}
          <span>{match.country ? `${match.country} · ` : ''}{match.league}</span>
        </div>
        <button onClick={onClose} className="btn-ghost text-xs" aria-label="Close">✕</button>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <TeamRow
          name={match.home}
          logo={match.homeLogo}
          align="left"
          onClick={() => onTeamClick?.({ id: match.homeId, name: match.home, logo: match.homeLogo })}
        />
        <div className="text-center">
          <div className="text-3xl font-black tabular-nums">
            {match.homeScore ?? 0} : {match.awayScore ?? 0}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-slate-400">
            {String(match.status).toUpperCase() === 'LIVE' ? `${match.minute || 0}'` : match.status}
          </div>
        </div>
        <TeamRow
          name={match.away}
          logo={match.awayLogo}
          align="right"
          onClick={() => onTeamClick?.({ id: match.awayId, name: match.away, logo: match.awayLogo })}
        />
      </div>
    </div>
  );
}

function TeamRow({ name, logo, align, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg p-1 transition hover:bg-white/5 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
    >
      {logo ? (
        <img src={logo} alt={name} className="h-10 w-10 rounded-full bg-slate-800 object-contain ring-2 ring-white/10" />
      ) : (
        <div className="h-10 w-10 rounded-full bg-slate-800 ring-2 ring-white/10" />
      )}
      <div className="min-w-0">
        <div className="truncate font-semibold">{name}</div>
        <div className="text-[10px] text-slate-500">Click xem đội</div>
      </div>
    </button>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-xl bg-white/5" />
      ))}
    </div>
  );
}

/* -------------------------------- LINEUP --------------------------------- */

function LineupView({ lineup, match }) {
  if (!lineup || (!lineup.home && !lineup.away)) {
    return <EmptyBlock text="Chưa có thông tin đội hình cho trận này." />;
  }
  return (
    <div className="space-y-6">
      <div className="glass p-4">
        <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
          <span>{lineup.confirmed ? 'Đội hình chính thức' : 'Đội hình dự kiến'}</span>
          <span>
            {lineup.home?.formation || '—'} <span className="mx-1 text-slate-600">vs</span>{' '}
            {lineup.away?.formation || '—'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TeamLineup side="home" name={match.home} data={lineup.home} />
          <TeamLineup side="away" name={match.away} data={lineup.away} />
        </div>
      </div>
    </div>
  );
}

function TeamLineup({ name, data, side }) {
  if (!data || !data.players?.length) {
    return <div className="text-sm text-slate-500">Chưa có dữ liệu</div>;
  }
  const starting = data.players.filter((p) => !p.substitute);
  const bench = data.players.filter((p) => p.substitute);
  return (
    <div>
      <div className={`mb-2 text-sm font-bold ${side === 'home' ? 'text-cyan-300' : 'text-rose-300'}`}>
        {name}
      </div>
      <div className="mb-3 space-y-1">
        {starting.map((p) => <PlayerRow key={p.id} p={p} />)}
      </div>
      {bench.length > 0 && (
        <>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Dự bị</div>
          <div className="space-y-1 opacity-80">
            {bench.map((p) => <PlayerRow key={p.id} p={p} />)}
          </div>
        </>
      )}
    </div>
  );
}

function PlayerRow({ p }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-xs">
      <span className="grid h-6 w-6 place-items-center rounded bg-slate-900 font-mono text-[10px] text-slate-300">
        {p.shirt || '-'}
      </span>
      <span className="flex-1 truncate">
        {p.name}
        {p.captain && <span className="ml-1 text-amber-300" title="Captain">©</span>}
      </span>
      <span className="flex items-center gap-1 text-[10px] text-slate-400">
        {p.goals > 0 && <span title="Goals">⚽{p.goals}</span>}
        {p.assists > 0 && <span title="Assists">🅰{p.assists}</span>}
        {p.yellowCards > 0 && <span className="text-yellow-400" title="Yellow">▮</span>}
        {p.redCards > 0 && <span className="text-red-500" title="Red">▮</span>}
        {p.rating && (
          <span className="rounded bg-emerald-500/20 px-1 font-bold text-emerald-300">
            {Number(p.rating).toFixed(1)}
          </span>
        )}
      </span>
    </div>
  );
}

/* -------------------------------- STATS ---------------------------------- */

function StatsView({ stats, match }) {
  if (!stats || !stats.length) {
    return <EmptyBlock text="Chưa có thống kê cho trận này." />;
  }
  const periods = ['ALL', '1ST', '2ND'];
  const [period] = ['ALL'];

  const filtered = stats.filter((s) => !s.period || s.period === period || s.period === 'ALL');
  return (
    <div className="glass p-4">
      <div className="mb-3 grid grid-cols-3 items-center text-xs text-slate-400">
        <div className="text-left font-semibold text-cyan-300 truncate">{match.home}</div>
        <div className="text-center">So sánh</div>
        <div className="text-right font-semibold text-rose-300 truncate">{match.away}</div>
      </div>
      <div className="space-y-3">
        {filtered.map((s, i) => <StatRow key={i} s={s} />)}
      </div>
    </div>
  );
}

function StatRow({ s }) {
  const home = parseFloat(String(s.home).replace('%', '')) || 0;
  const away = parseFloat(String(s.away).replace('%', '')) || 0;
  const total = home + away || 1;
  const homePct = (home / total) * 100;
  const awayPct = (away / total) * 100;
  return (
    <div>
      <div className="mb-1 grid grid-cols-3 text-sm">
        <div className="text-left font-bold tabular-nums">{s.home}</div>
        <div className="text-center text-xs text-slate-400">{s.name}</div>
        <div className="text-right font-bold tabular-nums">{s.away}</div>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-white/5">
        <div className="bg-cyan-400" style={{ width: `${homePct}%` }} />
        <div className="bg-rose-400" style={{ width: `${awayPct}%` }} />
      </div>
    </div>
  );
}

/* -------------------------------- EVENTS --------------------------------- */

function EventsView({ incidents, match }) {
  if (!incidents || !incidents.length) {
    return <EmptyBlock text="Chưa có diễn biến trận đấu." />;
  }
  return (
    <div className="glass p-4">
      <div className="relative pl-6">
        <div className="absolute left-2 top-0 bottom-0 w-px bg-white/10" />
        {incidents.map((it, i) => <IncidentRow key={i} it={it} match={match} />)}
      </div>
    </div>
  );
}

function IncidentRow({ it, match }) {
  const icon = typeIcon(it);
  return (
    <div className="relative mb-4 last:mb-0">
      <div className="absolute -left-4 top-1 grid h-4 w-4 place-items-center rounded-full bg-slate-900 ring-2 ring-cyan-400/60 text-[9px]">
        {icon}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">
          {it.time || 0}'{it.addedTime ? `+${it.addedTime}` : ''}
        </span>
        <span className={`truncate ${it.isHome ? 'text-cyan-200' : 'text-rose-200'}`}>
          {it.isHome ? match.home : match.away}
        </span>
      </div>
      <div className="ml-1 mt-0.5 text-xs text-slate-300">
        <span className="font-semibold">{it.player || it.text}</span>
        {it.assist && <span className="text-slate-500"> · kiến tạo: {it.assist}</span>}
        {(it.homeScore != null && it.awayScore != null) && (
          <span className="ml-2 font-black text-emerald-300">
            {it.homeScore}:{it.awayScore}
          </span>
        )}
      </div>
    </div>
  );
}

function typeIcon(it) {
  const t = String(it.type || '').toLowerCase();
  const c = String(it.class || '').toLowerCase();
  if (t === 'goal') return '⚽';
  if (t === 'card' && c.includes('red')) return '🟥';
  if (t === 'card') return '🟨';
  if (t === 'substitution') return '↔';
  if (t === 'period') return '⏱';
  return '•';
}

function StandingsView({ standings, match, onTeamClick }) {
  if (!standings || !standings.length) {
    return <EmptyBlock text="Chưa có bảng xếp hạng cho giải đấu này." />;
  }
  return (
    <div className="glass overflow-hidden">
      <div className="border-b border-white/10 px-4 py-3 text-sm text-slate-300">
        Bảng xếp hạng · {match.league}
      </div>
      <div className="max-h-[60vh] overflow-auto scrollbar-thin">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-900/95 text-slate-400">
            <tr>
              <th className="px-2 py-2 text-left">#</th>
              <th className="px-2 py-2 text-left">Đội</th>
              <th className="px-2 py-2 text-center">P</th>
              <th className="px-2 py-2 text-center">W</th>
              <th className="px-2 py-2 text-center">D</th>
              <th className="px-2 py-2 text-center">L</th>
              <th className="px-2 py-2 text-center">GD</th>
              <th className="px-2 py-2 text-center">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((r) => (
              <tr key={r.teamId || `${r.rank}-${r.teamName}`} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-2 py-2 font-bold">{r.rank}</td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    onClick={() => onTeamClick?.({ id: r.teamId, name: r.teamName, logo: r.teamLogo })}
                    className="flex items-center gap-2 text-left hover:text-cyan-300"
                  >
                    {r.teamLogo && <img src={r.teamLogo} alt="" className="h-5 w-5 rounded-full bg-slate-800 object-contain" />}
                    <span className="truncate">{r.teamName}</span>
                  </button>
                </td>
                <td className="px-2 py-2 text-center">{r.played}</td>
                <td className="px-2 py-2 text-center">{r.win}</td>
                <td className="px-2 py-2 text-center">{r.draw}</td>
                <td className="px-2 py-2 text-center">{r.loss}</td>
                <td className="px-2 py-2 text-center">{r.goalDiff}</td>
                <td className="px-2 py-2 text-center font-black text-cyan-300">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamQuickDrawer({ team, tournamentId, seasonId, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!team?.id) return;
    const ac = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    apiFetchTeamOverview({ teamId: team.id, tournamentId, seasonId }, ac.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(String(err.message || err));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [team?.id, tournamentId, seasonId]);

  return (
    <AnimatePresence>
      {team && (
        <motion.aside
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 280, damping: 32 }}
          className="fixed right-0 top-0 z-[60] h-full w-full overflow-y-auto border-l border-white/10 bg-slate-950 md:w-[520px]"
        >
          <div className="sticky top-0 border-b border-white/10 bg-slate-950/95 p-4 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {team.logo ? <img src={team.logo} alt="" className="h-8 w-8 rounded-full bg-slate-800 object-contain" /> : null}
                <div className="font-bold">{team.name}</div>
              </div>
              <button onClick={onClose} className="btn-ghost text-xs">Đóng</button>
            </div>
          </div>
          <div className="space-y-4 p-4">
            {loading && <Skeleton />}
            {error && <div className="rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-200">{error}</div>}
            {!loading && !error && data && (
              <>
                <div className="glass p-4 text-sm">
                  <div><span className="text-slate-400">Quốc gia:</span> {data.team?.country || '—'}</div>
                  <div><span className="text-slate-400">Sân nhà:</span> {data.team?.venue || '—'}</div>
                  <div><span className="text-slate-400">HLV:</span> {data.team?.manager || '—'}</div>
                  <div><span className="text-slate-400">Thành lập:</span> {data.team?.founded || '—'}</div>
                </div>
                <div className="glass p-4">
                  <div className="mb-2 text-sm font-bold">5-8 trận gần nhất</div>
                  <div className="space-y-2">
                    {(data.recentMatches || []).slice(0, 8).map((m) => (
                      <RecentMatchRow key={m.id} match={m} />
                    ))}
                    {!(data.recentMatches || []).length && (
                      <div className="py-4 text-center text-xs text-slate-500">Chưa có dữ liệu.</div>
                    )}
                  </div>
                </div>
                <StandingsView standings={data.standings || []} match={{ league: 'Giải đấu' }} />
              </>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function EmptyBlock({ text }) {
  return (
    <div className="glass p-10 text-center text-sm text-slate-400">{text}</div>
  );
}

const SOFA_IMG = 'https://api.sofascore.com/api/v1';

function teamLogoFallback(id) {
  if (!id) return '';
  return `${SOFA_IMG}/team/${id}/image`;
}

function leagueLogoFallback(id) {
  if (!id) return '';
  return `${SOFA_IMG}/unique-tournament/${id}/image`;
}

function TeamLogo({ src, fallbackId, name, size = 20 }) {
  const final = src || teamLogoFallback(fallbackId);
  if (!final) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full bg-slate-700 text-[9px] text-slate-300"
        style={{ width: size, height: size }}
      >
        {(name || '?').slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={final}
      alt={name || ''}
      width={size}
      height={size}
      loading="lazy"
      className="rounded-full bg-slate-800 object-contain"
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden';
      }}
    />
  );
}

function RecentMatchRow({ match }) {
  const leagueLogo = match.leagueLogo || leagueLogoFallback(match.tournamentId);
  return (
    <div className="rounded-lg bg-white/5 px-2 py-2 text-xs">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] text-slate-500">
        {leagueLogo && (
          <img
            src={leagueLogo}
            alt=""
            className="h-3 w-3 rounded-full bg-slate-800 object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        <span className="truncate">{match.league}</span>
        <span className="opacity-60">·</span>
        <span>{match.status}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <TeamLogo src={match.homeLogo} fallbackId={match.homeId} name={match.home} />
          <span className="truncate">{match.home}</span>
        </div>
        <span className="font-black tabular-nums">{match.homeScore}:{match.awayScore}</span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <span className="truncate text-right">{match.away}</span>
          <TeamLogo src={match.awayLogo} fallbackId={match.awayId} name={match.away} />
        </div>
      </div>
    </div>
  );
}
