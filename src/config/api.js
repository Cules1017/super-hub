export const GAS_URL = import.meta.env.VITE_GAS_URL || '';
export const ADMIN_TOKEN_ENV = import.meta.env.VITE_ADMIN_TOKEN || '';

const hasGas = () => Boolean(GAS_URL);

/**
 * GET: đọc toàn bộ settings + liveScore.
 * Dùng cache-busting để tránh CDN cache phía Google.
 */
export async function apiFetchAll(signal) {
  if (!hasGas()) return mockAll();
  const url = `${GAS_URL}?t=${Date.now()}`;
  const res = await fetch(url, { method: 'GET', signal, redirect: 'follow' });
  if (!res.ok) throw new Error(`GAS GET ${res.status}`);
  return res.json();
}

/**
 * POST: gửi cập nhật settings về Sheets.
 * GAS trả về JSON; dùng `text/plain` để tránh preflight CORS.
 */
export async function apiUpdateSettings(token, settings) {
  if (!hasGas()) {
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true, updated: Object.keys(settings).length, demo: true };
  }
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'updateSettings', token, settings }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
  if (!data.ok) throw new Error(data.error || 'Update failed');
  return data;
}

/**
 * GET ?matchId=... — chi tiết trận: lineup/stats/incidents.
 * Nguồn cache duy nhất là sheet (GAS xử lý bên trong): trận FT đã lưu vào
 * sheet `MatchDetails` sẽ được trả thẳng mà không gọi lại Sofa; trận LIVE/NS
 * sẽ crawl mới. Frontend không lưu localStorage nữa.
 */
export async function apiFetchMatchDetail(id, signal, status) {
  if (!GAS_URL) return mockMatchDetail(id);

  const query = new URLSearchParams({
    matchId: String(id),
    t: String(Date.now()),
  });
  if (status) query.set('status', String(status));
  const url = `${GAS_URL}?${query.toString()}`;
  const res = await fetch(url, { method: 'GET', signal, redirect: 'follow' });
  if (!res.ok) throw new Error(`GAS GET ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Load detail failed');
  return data.detail || {};
}

export async function apiFetchTeamOverview({ teamId, tournamentId, seasonId }, signal) {
  if (!GAS_URL) return mockTeamOverview(teamId);
  const q = new URLSearchParams({
    teamId: String(teamId || ''),
    tournamentId: String(tournamentId || ''),
    seasonId: String(seasonId || ''),
    t: String(Date.now()),
  });
  const res = await fetch(`${GAS_URL}?${q.toString()}`, { method: 'GET', signal, redirect: 'follow' });
  if (!res.ok) throw new Error(`GAS GET ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Load team failed');
  return data.detail;
}

function mockMatchDetail(id) {
  return {
    match: null,
    lineup: {
      confirmed: true,
      home: {
        formation: '4-3-3',
        players: Array.from({ length: 11 }).map((_, i) => ({
          id: i + 1, name: `Home Player ${i + 1}`, shortName: `H${i + 1}`,
          position: i === 0 ? 'G' : i < 5 ? 'D' : i < 8 ? 'M' : 'F',
          shirt: i + 1, substitute: false, captain: i === 3, rating: (6 + Math.random() * 3).toFixed(1),
          goals: i === 9 ? 1 : 0, assists: i === 7 ? 1 : 0, yellowCards: 0, redCards: 0, minutesPlayed: 90,
        })),
      },
      away: {
        formation: '4-2-3-1',
        players: Array.from({ length: 11 }).map((_, i) => ({
          id: 100 + i, name: `Away Player ${i + 1}`, shortName: `A${i + 1}`,
          position: i === 0 ? 'G' : i < 5 ? 'D' : i < 8 ? 'M' : 'F',
          shirt: i + 1, substitute: false, captain: i === 6, rating: (6 + Math.random() * 3).toFixed(1),
          goals: 0, assists: 0, yellowCards: i === 2 ? 1 : 0, redCards: 0, minutesPlayed: 90,
        })),
      },
    },
    stats: [
      { name: 'Ball possession', home: '58%', away: '42%' },
      { name: 'Total shots', home: 14, away: 9 },
      { name: 'Shots on target', home: 6, away: 3 },
      { name: 'Corner kicks', home: 7, away: 4 },
      { name: 'Fouls', home: 10, away: 13 },
      { name: 'Yellow cards', home: 1, away: 2 },
    ],
    incidents: [
      { type: 'goal', time: 23, isHome: true, player: 'Home Player 10', assist: 'Home Player 8', homeScore: 1, awayScore: 0 },
      { type: 'card', class: 'yellow', time: 35, isHome: false, player: 'Away Player 3' },
      { type: 'substitution', time: 60, isHome: true, player: 'Sub In', assist: 'Sub Out' },
    ],
    standings: [
      { rank: 1, teamId: 10, teamName: 'Arsenal', played: 30, win: 22, draw: 5, loss: 3, goalsFor: 62, goalsAgainst: 25, goalDiff: 37, points: 71 },
      { rank: 2, teamId: 11, teamName: 'Liverpool', played: 30, win: 21, draw: 6, loss: 3, goalsFor: 68, goalsAgainst: 30, goalDiff: 38, points: 69 },
      { rank: 3, teamId: 12, teamName: 'Chelsea', played: 30, win: 19, draw: 7, loss: 4, goalsFor: 55, goalsAgainst: 29, goalDiff: 26, points: 64 },
    ],
  };
}

function mockTeamOverview(teamId) {
  return {
    team: {
      id: teamId,
      name: 'Mock FC',
      country: 'England',
      venue: 'Mock Arena',
      manager: 'Mock Coach',
      founded: 1900,
      logo: '',
    },
    recentMatches: Array.from({ length: 5 }).map((_, i) => ({
      id: 100 + i,
      league: 'Premier League',
      status: i < 2 ? 'LIVE' : 'FT',
      minute: i < 2 ? 30 + i * 10 : 0,
      home: i % 2 ? 'Mock FC' : 'Rival FC',
      away: i % 2 ? 'Rival FC' : 'Mock FC',
      homeScore: 1 + (i % 3),
      awayScore: i % 2,
      startTime: new Date(Date.now() - i * 86400000).toISOString(),
    })),
    upcomingMatches: [],
    standings: [],
  };
}

export async function apiRefreshSports(token) {
  if (!hasGas()) return { ok: true, demo: true };
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'refreshSports', token }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
  if (!data.ok) throw new Error(data.error || 'Refresh failed');
  return data;
}

export async function apiSetupSettingsOnly(token) {
  if (!hasGas()) return { ok: true, demo: true, appended: 0 };
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'setupSettingsOnly', token }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
  if (!data.ok) throw new Error(data.error || 'Setup Settings failed');
  return data;
}

export async function apiResetBlacklist(token) {
  if (!hasGas()) return { ok: true, demo: true, removed: [] };
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'resetBlacklist', token }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
  if (!data.ok) throw new Error(data.error || 'Reset blacklist failed');
  return data;
}

export async function apiNormalizeSheets(token) {
  if (!hasGas()) return { ok: true, demo: true };
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'normalizeSheets', token }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
  if (!data.ok) throw new Error(data.error || 'Normalize failed');
  return data;
}

export async function apiCrawlTeamsByLeague(token, { tournamentId, seasonId, limit, forceRefresh }) {
  if (!hasGas()) return { ok: true, demo: true, success: 0, skipped: 0, failed: 0 };
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'crawlTeamsByLeague',
      token,
      tournamentId,
      seasonId,
      limit,
      forceRefresh: !!forceRefresh,
    }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
  if (!data.ok) throw new Error(data.error || 'Crawl by league failed');
  return data;
}

export async function apiFetchTopPlayers({ tournamentId, seasonId, category, limit }, signal) {
  if (!hasGas()) return mockTopPlayers(category);
  const q = new URLSearchParams({
    topPlayers: '1',
    tournamentId: String(tournamentId || ''),
    t: String(Date.now()),
  });
  if (seasonId) q.set('seasonId', String(seasonId));
  if (category) q.set('category', String(category));
  if (limit) q.set('limit', String(limit));
  const res = await fetch(`${GAS_URL}?${q.toString()}`, { method: 'GET', signal, redirect: 'follow' });
  if (!res.ok) throw new Error(`GAS GET ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Load top players failed');
  return {
    topPlayers: (data.detail && data.detail.topPlayers) || [],
    seasonId: data.seasonId || '',
    source: (data.detail && data.detail._source) || '',
    updatedAt: (data.detail && data.detail._updatedAt) || 0,
    category: data.category || category || 'goals',
    tournamentId: data.tournamentId || tournamentId,
  };
}

export async function apiFetchDefaultLeagues(locale = 'VN', signal) {
  if (!hasGas()) return mockDefaultLeagues();
  const q = new URLSearchParams({ defaultLeagues: '1', locale, t: String(Date.now()) });
  const res = await fetch(`${GAS_URL}?${q.toString()}`, { method: 'GET', signal, redirect: 'follow' });
  if (!res.ok) throw new Error(`GAS GET ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Load default leagues failed');
  return data.items || [];
}

export async function apiSeedFeaturedFromSofa(token, locale = 'VN') {
  if (!hasGas()) return { ok: true, demo: true, count: 0 };
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'seedFeaturedFromSofa', token, locale }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
  if (!data.ok) throw new Error(data.error || 'Seed featured failed');
  return data;
}

export async function apiFetchTournamentInfo(tournamentId, signal) {
  if (!hasGas()) return { id: Number(tournamentId), name: 'Demo League', logo: '' };
  const q = new URLSearchParams({
    tournamentInfo: '1',
    tournamentId: String(tournamentId || ''),
    t: String(Date.now()),
  });
  const res = await fetch(`${GAS_URL}?${q.toString()}`, { method: 'GET', signal, redirect: 'follow' });
  if (!res.ok) throw new Error(`GAS GET ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Load tournament info failed');
  return data.detail || null;
}

export async function apiFetchTopLeagues(n, signal) {
  if (!hasGas()) return mockDefaultLeagues().slice(0, Number(n) || 8);
  const q = new URLSearchParams({ topLeagues: '1', t: String(Date.now()) });
  if (n) q.set('n', String(n));
  const res = await fetch(`${GAS_URL}?${q.toString()}`, { method: 'GET', signal, redirect: 'follow' });
  if (!res.ok) throw new Error(`GAS GET ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Load top leagues failed');
  return data.items || [];
}

export async function apiCrawlTournamentInfo(token, tournamentId) {
  if (!hasGas()) return { ok: true, demo: true };
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'crawlTournamentInfo', token, tournamentId }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
  if (!data.ok) throw new Error(data.error || 'Crawl tournament info failed');
  return data;
}

export async function apiCrawlTopLeaguesInfo(token, { n, forceRefresh }) {
  return postTopLeagues(token, 'crawlTopLeaguesInfo', { n, forceRefresh });
}

export async function apiCrawlTopLeaguesTeams(token, { n, teamLimit, forceRefresh }) {
  return postTopLeagues(token, 'crawlTopLeaguesTeams', { n, teamLimit, forceRefresh });
}

export async function apiCrawlTopLeaguesTopPlayers(token, { n, categories, forceRefresh }) {
  return postTopLeagues(token, 'crawlTopLeaguesTopPlayers', { n, categories, forceRefresh });
}

export async function apiCrawlTopLeaguesAll(token, { n, teamLimit, categories, forceRefresh }) {
  return postTopLeagues(token, 'crawlTopLeaguesAll', { n, teamLimit, categories, forceRefresh });
}

async function postTopLeagues(token, action, body) {
  if (!hasGas()) return { ok: true, demo: true, count: body?.n || 0, results: [] };
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token, ...body }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
  if (!data.ok) throw new Error(data.error || `${action} failed`);
  return data;
}

export async function apiCrawlTopPlayers(token, { tournamentId, seasonId, categories, forceRefresh }) {
  if (!hasGas()) return { ok: true, demo: true, results: [] };
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'crawlTopPlayers',
      token,
      tournamentId,
      seasonId,
      categories,
      forceRefresh: !!forceRefresh,
    }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
  if (!data.ok) throw new Error(data.error || 'Crawl top players failed');
  return data;
}

export async function apiCrawlTeamsByIds(token, { items, forceRefresh }) {
  if (!hasGas()) return { ok: true, demo: true, success: 0, skipped: 0, failed: 0 };
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'crawlTeamsByIds',
      token,
      items,
      forceRefresh: !!forceRefresh,
    }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));
  if (!data.ok) throw new Error(data.error || 'Crawl by ids failed');
  return data;
}

/* ------------------------- Mock dữ liệu cho local ------------------------- */

function mockTopPlayers(category) {
  const cat = String(category || 'goals').toLowerCase();
  const base = [
    { playerId: 1001, name: 'Erling Haaland', shortName: 'E. Haaland', teamId: 17, teamName: 'Man City', teamLogo: '', playerLogo: '', appearances: 28, minutesPlayed: 2450, goals: 25, assists: 6, rating: 7.9, position: 'F' },
    { playerId: 1002, name: 'Mohamed Salah', shortName: 'M. Salah', teamId: 44, teamName: 'Liverpool', teamLogo: '', playerLogo: '', appearances: 30, minutesPlayed: 2600, goals: 22, assists: 9, rating: 7.7, position: 'F' },
    { playerId: 1003, name: 'Harry Kane', shortName: 'H. Kane', teamId: 2672, teamName: 'Bayern', teamLogo: '', playerLogo: '', appearances: 27, minutesPlayed: 2400, goals: 28, assists: 7, rating: 7.8, position: 'F' },
    { playerId: 1004, name: 'Kylian Mbappe', shortName: 'K. Mbappe', teamId: 2829, teamName: 'Real Madrid', teamLogo: '', playerLogo: '', appearances: 29, minutesPlayed: 2500, goals: 24, assists: 10, rating: 7.9, position: 'F' },
    { playerId: 1005, name: 'Lautaro Martinez', shortName: 'L. Martinez', teamId: 2697, teamName: 'Inter', teamLogo: '', playerLogo: '', appearances: 28, minutesPlayed: 2380, goals: 21, assists: 5, rating: 7.6, position: 'F' },
  ];
  const sorted = [...base].sort((a, b) => {
    if (cat === 'assists') return b.assists - a.assists;
    if (cat === 'rating') return b.rating - a.rating;
    return b.goals - a.goals;
  });
  return {
    topPlayers: sorted,
    seasonId: 'mock-season',
    source: 'mock',
    updatedAt: Date.now(),
    category: cat,
    tournamentId: '17',
  };
}

function mockDefaultLeagues() {
  return [
    { order: 1, id: 17, name: 'Premier League', slug: 'premier-league', primaryColorHex: '#3c1c5a' },
    { order: 2, id: 8, name: 'LaLiga', slug: 'laliga', primaryColorHex: '#2f4a89' },
    { order: 3, id: 23, name: 'Serie A', slug: 'serie-a', primaryColorHex: '#09519e' },
    { order: 4, id: 35, name: 'Bundesliga', slug: 'bundesliga', primaryColorHex: '#e2080e' },
    { order: 5, id: 626, name: 'V-League 1', slug: 'v-league-1', primaryColorHex: '#e32b19' },
  ];
}

function mockAll() {
  return {
    ok: true,
    ts: Date.now(),
    settings: {
      site_name: 'Mega Hub',
      site_tagline: 'Đa tiện ích – Siêu tốc độ',
      meta_title: 'Mega Hub – Live Score & Tiện ích online',
      meta_description: 'Cập nhật tỉ số trực tiếp, thống kê bóng đá và các tiện ích online miễn phí.',
      meta_keywords: 'livescore, bong da, ty so truc tiep',
      primary_color: '#22d3ee',
      accent_color: '#f59e0b',
      announcement: '[DEMO] Chạy local không có VITE_GAS_URL – dữ liệu đang là mock.',
      announcement_enabled: true,
      maintenance_mode: false,
      ads_enabled: true,
      adsense_client: 'ca-pub-XXXXXXXXXXXXXXXX',
      ads_slot_header_enabled: true,
      ads_slot_header: '1111111111',
      ads_slot_inline_enabled: true,
      ads_slot_inline: '2222222222',
      ads_slot_sidebar_enabled: true,
      ads_slot_sidebar: '3333333333',
      ads_slot_footer_enabled: true,
      ads_slot_footer: '4444444444',
      poll_interval_ms: 60000,
    },
    liveScore: [
      { id: 1, league: 'Premier League', status: 'LIVE', minute: 57, home: 'Arsenal', homeLogo: '', homeScore: 2, away: 'Chelsea', awayLogo: '', awayScore: 1, startTime: new Date().toISOString(), homeId: '10', awayId: '12', tournamentId: '17', seasonId: '52376' },
      { id: 2, league: 'La Liga', status: 'LIVE', minute: 22, home: 'Real Madrid', homeLogo: '', homeScore: 0, away: 'Barcelona', awayLogo: '', awayScore: 0, startTime: new Date().toISOString(), homeId: '20', awayId: '21', tournamentId: '8', seasonId: '52375' },
      { id: 3, league: 'Serie A', status: 'HT', minute: 45, home: 'Juventus', homeLogo: '', homeScore: 1, away: 'Inter', awayLogo: '', awayScore: 1, startTime: new Date().toISOString(), homeId: '30', awayId: '31', tournamentId: '23', seasonId: '52377' },
      { id: 4, league: 'V-League', status: 'LIVE', minute: 71, home: 'HAGL', homeLogo: '', homeScore: 3, away: 'Hà Nội FC', awayLogo: '', awayScore: 2, startTime: new Date().toISOString(), homeId: '40', awayId: '41', tournamentId: '404', seasonId: '52378' },
    ],
  };
}
