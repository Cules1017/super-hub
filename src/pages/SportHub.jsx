import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useConfig } from '../hooks/useConfig.jsx';
import MatchCard from '../components/sport/MatchCard.jsx';
import MatchDetailDrawer from '../components/sport/MatchDetailDrawer.jsx';
import TopPlayersPanel from '../components/sport/TopPlayersPanel.jsx';
import AdsPlaceholder from '../components/ads/AdsPlaceholder.jsx';
import SEO from '../components/ui/SEO.jsx';

const FAV_KEY = 'mega_hub_favorite_teams';

export default function SportHub() {
  const { liveScore, get, reload, lastUpdated, loading } = useConfig();
  const [filter, setFilter] = useState('ALL');
  const [leagueFilter, setLeagueFilter] = useState('ALL');
  const [selected, setSelected] = useState(null);
  const [showAllLeagues, setShowAllLeagues] = useState(false);
  const [favoriteTeamIds, setFavoriteTeamIds] = useState(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  });

  const featuredLeagues = useMemo(() => {
    const raw = String(get('featured_leagues', '') || '');
    return raw
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean);
  }, [get]);

  const featuredTournamentIds = useMemo(() => {
    const raw = String(get('featured_tournament_ids', '') || '');
    return raw
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean);
  }, [get]);

  const featuredLeagueLimit = useMemo(
    () => Math.max(1, Number(get('featured_league_limit', 12)) || 12),
    [get]
  );

  // Khoá định danh duy nhất cho 1 giải đấu: ưu tiên tournamentId (chống nhầm các "Premier League"
  // của nhiều nước khác nhau có cùng tên). Fallback về country+name nếu thiếu tournamentId.
  const leagueKeyOf = (m) => {
    if (m?.tournamentId) return `t:${m.tournamentId}`;
    const name = m?.league || 'Khác';
    const country = m?.country || '';
    return `n:${country}|${name}`;
  };
  const leagueLabelOf = (m) =>
    m?.leagueDisplay || (m?.country ? `${m.country} · ${m.league || 'Khác'}` : m?.league || 'Khác');

  const leagues = useMemo(() => {
    const map = {};
    (liveScore || []).forEach((m) => {
      const key = leagueKeyOf(m);
      if (!map[key]) {
        map[key] = {
          key,
          tournamentId: m.tournamentId || '',
          name: m.league || 'Khác',
          country: m.country || '',
          display: leagueLabelOf(m),
          logo: m.leagueLogo || '',
          count: 0,
        };
      }
      map[key].count += 1;
    });
    const arr = Object.values(map);
    const idPinMap = {};
    featuredTournamentIds.forEach((id, i) => { idPinMap[id] = i; });
    const namePinMap = {};
    featuredLeagues.forEach((name, i) => { namePinMap[name.toLowerCase()] = i; });
    const pinOf = (l) => {
      if (l.tournamentId && idPinMap[l.tournamentId] !== undefined) return idPinMap[l.tournamentId];
      const byDisplay = namePinMap[l.display.toLowerCase()];
      if (byDisplay !== undefined) return byDisplay + 1000;
      const byName = namePinMap[l.name.toLowerCase()];
      if (byName !== undefined) return byName + 2000;
      return -1;
    };
    return arr.sort((a, b) => {
      const ap = pinOf(a);
      const bp = pinOf(b);
      const aPinned = ap >= 0;
      const bPinned = bp >= 0;
      if (aPinned && bPinned) return ap - bp;
      if (aPinned) return -1;
      if (bPinned) return 1;
      return b.count - a.count;
    });
  }, [liveScore, featuredLeagues, featuredTournamentIds]);
  const topLeagues = useMemo(() => leagues.slice(0, featuredLeagueLimit), [leagues, featuredLeagueLimit]);
  const moreLeagues = useMemo(() => leagues.slice(featuredLeagueLimit), [leagues, featuredLeagueLimit]);

  const groups = useMemo(() => {
    const byLeague = {};
    (liveScore || []).forEach((m) => {
      const key = leagueKeyOf(m);
      if (!byLeague[key]) {
        byLeague[key] = {
          key,
          display: leagueLabelOf(m),
          logo: m.leagueLogo || '',
          matches: [],
        };
      }
      byLeague[key].matches.push(m);
    });
    return Object.values(byLeague).sort((a, b) => b.matches.length - a.matches.length);
  }, [liveScore]);

  const filtered = useMemo(() => {
    return (liveScore || []).filter((m) => {
      const byStatus = filter === 'ALL' || String(m.status).toUpperCase() === filter;
      const byLeague = leagueFilter === 'ALL' || leagueKeyOf(m) === leagueFilter;
      return byStatus && byLeague;
    });
  }, [liveScore, filter, leagueFilter]);

  const favoriteMatches = useMemo(
    () =>
      filtered.filter(
        (m) =>
          favoriteTeamIds.includes(String(m.homeId || '')) ||
          favoriteTeamIds.includes(String(m.awayId || ''))
      ),
    [filtered, favoriteTeamIds]
  );

  function handleToggleFavoriteTeam(team) {
    const id = String(team?.id || '').trim();
    if (!id) return;
    setFavoriteTeamIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
      return next;
    });
  }

  const jsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: `${get('site_name', 'Mega Hub')} – Live Score`,
      description: get('meta_description', ''),
      startDate: new Date().toISOString(),
    }),
    [get]
  );

  return (
    <div className="space-y-6">
      <SEO
        title={`Live Score – ${get('site_name', 'Mega Hub')}`}
        description="Cập nhật tỉ số trực tiếp bóng đá các giải đấu hàng đầu thế giới."
        jsonLd={jsonLd}
      />

      <StadiumHero
        siteName={get('site_name', 'Mega Hub')}
        pollMs={Number(get('poll_interval_ms', 60000)) || 60000}
        lastUpdated={lastUpdated}
        liveScore={liveScore}
        filter={filter}
        onFilter={setFilter}
        onReload={reload}
        loading={loading}
      />

      <section className="glass p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex h-6 w-1 rounded-full bg-gradient-to-b from-cyan-400 to-indigo-500" />
          <div className="section-title">Danh sách giải đấu</div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setLeagueFilter('ALL')}
            className={`pill-theme ${leagueFilter === 'ALL' ? 'is-active' : ''}`}
          >
            Tất cả ({liveScore?.length || 0})
          </button>
          {topLeagues.map((l) => (
            <LeagueLogoButton
              key={l.key}
              league={l}
              active={leagueFilter === l.key}
              onClick={() => setLeagueFilter(l.key)}
            />
          ))}
          {showAllLeagues &&
            moreLeagues.map((l) => (
              <LeagueLogoButton
                key={l.key}
                league={l}
                active={leagueFilter === l.key}
                onClick={() => setLeagueFilter(l.key)}
              />
            ))}
          {moreLeagues.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAllLeagues((v) => !v)}
              className="pill-theme"
            >
              {showAllLeagues ? 'Thu gọn' : `Xem thêm (${moreLeagues.length})`}
            </button>
          )}
        </div>
      </section>

      <TopPlayersPanel
        liveScore={liveScore}
        leagueFilterKey={leagueFilter}
        leagueKeyOf={leagueKeyOf}
        featuredTournamentIds={featuredTournamentIds}
        featuredLeagues={featuredLeagues}
        limit={Number(get('top_players_limit', 5)) || 5}
        enabled={String(get('top_players_enabled', 'true')) !== 'false'}
      />

      <AdsPlaceholder slot="header" label="header" />

      {filtered.length === 0 ? (
        <div className="glass p-10 text-center text-slate-400">
          Không có trận đấu phù hợp bộ lọc.
        </div>
      ) : (
        <div className="space-y-8">
          {favoriteMatches.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-3">
                <span className="inline-flex h-5 w-1 rounded-full bg-gradient-to-b from-amber-400 to-orange-500" />
                <h2 className="section-title text-amber-500">Yêu thích</h2>
                <div className="divider-line" />
                <span className="section-caption">{favoriteMatches.length} trận</span>
              </div>
              <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {favoriteMatches.map((m) => (
                  <MatchCard
                    key={`fav-${m.id}`}
                    match={m}
                    onClick={() => setSelected(m)}
                    favoriteTeamIds={favoriteTeamIds}
                    onToggleFavoriteTeam={handleToggleFavoriteTeam}
                  />
                ))}
              </motion.div>
            </section>
          )}
          {groups.map((group, idx) => {
            const visible = group.matches.filter(
              (m) =>
                (filter === 'ALL' || String(m.status).toUpperCase() === filter) &&
                (leagueFilter === 'ALL' || leagueKeyOf(m) === leagueFilter)
            );
            if (!visible.length) return null;
            return (
              <section key={group.key}>
                <div className="mb-3 flex items-center gap-3">
                  <span className="inline-flex h-5 w-1 rounded-full bg-gradient-to-b from-cyan-400 to-indigo-500" />
                  {group.logo && (
                    <img
                      src={group.logo}
                      alt=""
                      className="h-6 w-6 rounded-full bg-slate-900/40 object-contain"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  <h2 className="section-title">{group.display}</h2>
                  <div className="divider-line" />
                  <span className="section-caption">{visible.length} trận</span>
                </div>
                <motion.div
                  layout
                  className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
                >
                  {visible.map((m) => (
                    <MatchCard
                      key={m.id}
                      match={m}
                      onClick={() => setSelected(m)}
                      favoriteTeamIds={favoriteTeamIds}
                      onToggleFavoriteTeam={handleToggleFavoriteTeam}
                    />
                  ))}
                </motion.div>
                {idx === 0 && (
                  <div className="mt-6">
                    <AdsPlaceholder slot="inline" label="inline" />
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <AdsPlaceholder slot="sidebar" label="sidebar" />

      <MatchDetailDrawer match={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function LeagueLogoButton({ league, active, onClick }) {
  const label = league.display || league.name;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`league-tile ${active ? 'is-active' : ''}`}
      title={`${label} (${league.count} trận)`}
      aria-label={label}
    >
      {league.logo ? (
        <img
          src={league.logo}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <span className="text-[10px] font-bold">
          {String(label || '?').slice(0, 2).toUpperCase()}
        </span>
      )}
    </button>
  );
}

function StadiumHero({ siteName, pollMs, lastUpdated, liveScore, filter, onFilter, onReload, loading }) {
  const counts = useMemo(() => {
    const out = { ALL: 0, LIVE: 0, HT: 0, FT: 0, NS: 0 };
    (liveScore || []).forEach((m) => {
      out.ALL += 1;
      const s = String(m.status || '').toUpperCase();
      if (s === 'LIVE') out.LIVE += 1;
      else if (s === 'HT') out.HT += 1;
      else if (s === 'FT' || s === 'AET' || s === 'PEN') out.FT += 1;
      else if (s === 'NS') out.NS += 1;
    });
    return out;
  }, [liveScore]);

  const pollSec = Math.round(pollMs / 1000);

  return (
    <section className="stadium-hero relative p-6 md:p-7">
      <div className="relative z-10 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.25em] text-white backdrop-blur">
            <span className="live-dot" /> Live Score Stadium
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white md:text-4xl">
            {siteName} · Sport Hub
          </h1>
          <p className="mt-1 max-w-xl text-sm text-white/80">
            Nhịp đập bóng đá thế giới – cập nhật mỗi{' '}
            <span className="font-bold text-cyan-200">{pollSec}s</span>
            {' · '}Lần cuối:{' '}
            <span className="font-semibold text-white">
              {lastUpdated ? new Date(lastUpdated).toLocaleTimeString('vi-VN') : '—'}
            </span>
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { k: 'ALL', label: 'Tất cả' },
              { k: 'LIVE', label: 'LIVE' },
              { k: 'HT', label: 'HT' },
              { k: 'FT', label: 'FT' },
            ].map((item) => (
              <button
                key={item.k}
                onClick={() => onFilter(item.k)}
                className={`pill-tab ${filter === item.k ? 'is-active' : ''}`}
              >
                {item.k === 'LIVE' && <span className="live-dot mr-1" />}
                {item.label}
                <span className="ml-1 opacity-70">({counts[item.k] || 0})</span>
              </button>
            ))}
            <button onClick={onReload} className="btn-ghost text-xs" disabled={loading}>
              ↻ Refresh
            </button>
          </div>
        </div>

        <div className="scoreboard flex items-center gap-4 px-5 py-4">
          <HeroStat label="LIVE" value={counts.LIVE} accent="text-rose-300" />
          <div className="h-10 w-px bg-white/20" />
          <HeroStat label="HT" value={counts.HT} accent="text-amber-200" />
          <div className="h-10 w-px bg-white/20" />
          <HeroStat label="FT" value={counts.FT} accent="text-cyan-200" />
          <div className="h-10 w-px bg-white/20" />
          <HeroStat label="Sắp đá" value={counts.NS} accent="text-slate-200" />
        </div>
      </div>
    </section>
  );
}

function HeroStat({ label, value, accent }) {
  return (
    <div className="min-w-[64px] text-center">
      <div className={`text-3xl font-black tabular-nums ${accent}`}>{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">{label}</div>
    </div>
  );
}
