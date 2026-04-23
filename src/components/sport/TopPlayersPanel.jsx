import { useEffect, useMemo, useState } from 'react';
import { apiFetchTopPlayers } from '../../config/api.js';

const CATEGORIES = [
  { key: 'goals', label: 'Vua phá lưới', icon: '⚽', statLabel: 'Bàn' },
  { key: 'assists', label: 'Kiến tạo', icon: '🎯', statLabel: 'Kt' },
  { key: 'rating', label: 'Điểm cao', icon: '⭐', statLabel: 'Rating' },
];

/**
 * Panel Top Player bám theo league đang chọn trên Sport Hub.
 * - tournamentId/seasonId được suy từ 1 trận bất kỳ thuộc league đó (có trong LiveScore).
 * - Nếu không có tournamentId hợp lệ -> panel ẩn.
 */
export default function TopPlayersPanel({
  liveScore,
  leagueFilterKey,
  leagueKeyOf,
  featuredTournamentIds,
  featuredLeagues,
  limit = 5,
  enabled = true,
}) {
  const [category, setCategory] = useState('goals');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const target = useMemo(() => {
    if (!enabled) return null;
    return pickTargetLeague({
      liveScore: liveScore || [],
      leagueFilterKey,
      leagueKeyOf,
      featuredTournamentIds: featuredTournamentIds || [],
      featuredLeagues: featuredLeagues || [],
    });
  }, [enabled, liveScore, leagueFilterKey, leagueKeyOf, featuredTournamentIds, featuredLeagues]);

  useEffect(() => {
    if (!target || !target.tournamentId) {
      setData(null);
      setError('');
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    apiFetchTopPlayers(
      {
        tournamentId: target.tournamentId,
        seasonId: target.seasonId,
        category,
        limit,
      },
      controller.signal
    )
      .then((res) => setData(res))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(String(err.message || err));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [target, category, limit]);

  if (!enabled || !target || !target.tournamentId) return null;

  const players = data?.topPlayers || [];
  const meta = CATEGORIES.find((c) => c.key === category) || CATEGORIES[0];

  return (
    <section className="glass p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="inline-flex h-6 w-1 rounded-full bg-gradient-to-b from-amber-400 to-rose-500" />
        <div>
          <div className="section-title">🏆 Top Player · {target.league}</div>
          <div className="section-caption">
            Dữ liệu cả mùa giải · nguồn: SofaScore
            {data?.source === 'sheet-fresh' && ' · cache sheet'}
            {data?.source === 'sheet-stale' && ' · cache (cũ)'}
            {data?.source === 'cache' && ' · cache nhanh'}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className={`pill-tab ${category === c.key ? 'is-active' : ''}`}
            >
              <span className="mr-1">{c.icon}</span>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !players.length ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: limit }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          Không tải được dữ liệu Top Player: {error}
        </div>
      ) : !players.length ? (
        <div className="rounded-lg border border-dashed border-white/20 p-6 text-center text-sm opacity-70">
          Chưa có dữ liệu {meta.label.toLowerCase()} cho giải này.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {players.map((p, idx) => (
            <PlayerRow key={`${p.playerId}-${idx}`} rank={idx + 1} player={p} category={category} statLabel={meta.statLabel} />
          ))}
        </div>
      )}
    </section>
  );
}

function PlayerRow({ rank, player, category, statLabel }) {
  const stat = formatStat(player, category);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2.5 transition-colors hover:bg-white/10">
      <div className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg text-xs font-black ${rankBadge(rank)}`}>
        {rank}
      </div>
      <PlayerAvatar player={player} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold leading-tight">{player.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] opacity-80">
          <TeamLogo team={player} size={14} />
          <span className="truncate">{player.teamShortName || player.teamName}</span>
          {player.position && (
            <span className="rounded bg-white/10 px-1.5 text-[9px] font-bold uppercase tracking-wider">
              {player.position}
            </span>
          )}
        </div>
      </div>
      <div className="flex-none text-right">
        <div className="text-lg font-black tabular-nums text-amber-300">{stat}</div>
        <div className="text-[9px] font-bold uppercase tracking-widest opacity-60">{statLabel}</div>
      </div>
    </div>
  );
}

function PlayerAvatar({ player }) {
  const [src, setSrc] = useState(
    player.playerLogo ||
      (player.playerId ? `https://api.sofascore.app/api/v1/player/${player.playerId}/image` : '')
  );
  if (!src) {
    return (
      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-xs font-bold text-white">
        {initials(player.name)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="h-10 w-10 flex-none rounded-full bg-white/10 object-cover"
      onError={() => setSrc('')}
    />
  );
}

function TeamLogo({ team, size = 14 }) {
  const [src, setSrc] = useState(
    team.teamLogo || (team.teamId ? `https://api.sofascore.app/api/v1/team/${team.teamId}/image` : '')
  );
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="rounded-sm bg-white/20"
      style={{ width: size, height: size }}
      onError={() => setSrc('')}
    />
  );
}

function rankBadge(rank) {
  if (rank === 1) return 'bg-gradient-to-br from-amber-400 to-amber-600 text-black';
  if (rank === 2) return 'bg-gradient-to-br from-slate-300 to-slate-500 text-black';
  if (rank === 3) return 'bg-gradient-to-br from-orange-400 to-orange-700 text-white';
  return 'bg-white/10';
}

function formatStat(player, category) {
  if (category === 'assists') return player.assists ?? 0;
  if (category === 'rating') {
    const v = Number(player.rating || 0);
    return v ? v.toFixed(2) : '—';
  }
  return player.goals ?? 0;
}

function initials(name) {
  if (!name) return '?';
  return String(name)
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
}

function pickTargetLeague({ liveScore, leagueFilterKey, leagueKeyOf, featuredTournamentIds, featuredLeagues }) {
  if (!liveScore.length) return null;

  const mapMatchToTarget = (match) => {
    if (!match || !match.tournamentId) return null;
    return {
      league: match.leagueDisplay || match.league || 'Giải đấu',
      tournamentId: String(match.tournamentId),
      seasonId: String(match.seasonId || ''),
    };
  };

  if (leagueFilterKey && leagueFilterKey !== 'ALL') {
    const match = liveScore.find((m) => typeof leagueKeyOf === 'function' && leagueKeyOf(m) === leagueFilterKey && m.tournamentId);
    const mapped = mapMatchToTarget(match);
    if (mapped) return mapped;
  }

  for (const id of featuredTournamentIds || []) {
    const match = liveScore.find((m) => String(m.tournamentId || '') === String(id));
    const mapped = mapMatchToTarget(match);
    if (mapped) return mapped;
  }

  for (const name of featuredLeagues || []) {
    const lower = String(name || '').toLowerCase();
    const match = liveScore.find((m) => {
      if (!m.tournamentId) return false;
      return (
        String(m.league || '').toLowerCase() === lower ||
        String(m.leagueDisplay || '').toLowerCase() === lower
      );
    });
    const mapped = mapMatchToTarget(match);
    if (mapped) return mapped;
  }

  const first = liveScore.find((m) => m.tournamentId);
  return mapMatchToTarget(first);
}
