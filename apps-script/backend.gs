/**
 * ============================================================================
 *  MEGA-SITE ĐA TIỆN ÍCH – BACKEND (Google Apps Script) — Auto Crawler v2
 * ----------------------------------------------------------------------------
 *  Nguồn dữ liệu (không cần API key):
 *    - Live matches / Lineups / Stats / Incidents: api.sofascore.com (public)
 *    - Fallback (có key): API-Football (v3.football.api-sports.io)
 *
 *  Endpoints Web App:
 *    GET  ?                          → { settings, liveScore }
 *    GET  ?matchId=<id>              → { match, lineup, stats, incidents }
 *    POST { action, token, ... }     → updateSettings | refreshSports
 *
 *  Deploy / Trigger:
 *    1) setupSpreadsheet() 1 lần
 *       -> tạo tab: Settings, LiveScore, MatchDetails, TeamDaily, Standings.
 *    2) Deploy -> New deployment -> Web app -> Anyone.
 *    3) MỖI LẦN sửa backend.gs đều phải: Manage deployments -> Edit -> New version -> Deploy.
 *    4) Trigger time-driven:
 *       - fetchSportsData: mỗi 1 phút.
 *       - crawlFinishedMatchesDaily: mỗi ngày 1 lần (ví dụ 01:00).
 *       - crawlTeamsDaily: mỗi ngày 1 lần (ví dụ 02:00).
 * ============================================================================
 */

const ADMIN_TOKEN = 'CHANGE_ME_SUPER_SECRET_TOKEN';

const SHEET_SETTINGS     = 'Settings';
const SHEET_LIVESCORE    = 'LiveScore';
const SHEET_MATCHDETAILS = 'MatchDetails';
const SHEET_TEAM_DAILY   = 'TeamDaily';
const SHEET_STANDINGS    = 'Standings';
const SHEET_TOPPLAYERS   = 'TopPlayers';
const SHEET_TOURNAMENTS  = 'TournamentInfo';

const SOFA = 'https://api.sofascore.com/api/v1';
// Host ảnh CDN (dùng cho <img> trên trình duyệt). `api.sofascore.app` hay bị 403 hotlink ->
// ưu tiên CDN `img.sofascore.com`. Frontend có <SofaImage> tự fallback sang host khác nếu vẫn lỗi.
const SOFA_IMG = 'https://img.sofascore.com/api/v1';
const SPORTSDB = 'https://www.thesportsdb.com/api/v1/json/3';

// Các domain mirror của SofaScore – khi host chính bị 403 sẽ auto-retry.
const SOFA_MIRRORS = [
  'https://api.sofascore.com/api/v1',
  'https://www.sofascore.com/api/v1',
  'https://api.sofascore.app/api/v1',
];

// Pool User-Agent: xoay vòng để giảm khả năng bị block theo fingerprint.
const UA_POOL = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
];
const UA = UA_POOL[0];
const HTTP_HEADERS = { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' };

function pickUA_() { return UA_POOL[Math.floor(Math.random() * UA_POOL.length)]; }

function buildBrowserHeaders_(referer) {
  return {
    'User-Agent': pickUA_(),
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': referer || 'https://www.sofascore.com/',
    'Origin': 'https://www.sofascore.com',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Dest': 'empty',
  };
}

function hostOf_(url) {
  const m = String(url || '').match(/^https?:\/\/([^/]+)/i);
  return m ? m[1] : '';
}

/** Circuit breaker: nếu 1 host đã 403 quá nhiều -> tạm blacklist để khỏi tốn quota. */
function isHostBlacklisted_(host) {
  try {
    return !!CacheService.getScriptCache().get('bl:' + host);
  } catch (_) { return false; }
}
function blacklistHost_(host, seconds) {
  try { CacheService.getScriptCache().put('bl:' + host, '1', Math.max(30, seconds || 300)); }
  catch (_) { /* noop */ }
}

/** Xoá blacklist của tất cả domain để thử crawl lại ngay. */
function resetHostBlacklist_() {
  const cache = CacheService.getScriptCache();
  const hosts = [];
  SOFA_MIRRORS.forEach(function (u) { hosts.push(hostOf_(u)); });
  hosts.push(hostOf_(SPORTSDB));
  hosts.push('v3.football.api-sports.io');
  const keys = hosts.map(function (h) { return 'bl:' + h; });
  try { cache.removeAll(keys); } catch (_) { /* noop */ }
  try { cache.remove('sofa:preferred'); } catch (_) { /* noop */ }
  return hosts;
}

const LIVESCORE_COLUMNS = [
  'id', 'league', 'leagueDisplay', 'leagueLogo', 'country', 'categorySlug', 'categoryAlpha2', 'categoryFlag',
  'status', 'minute',
  'home', 'homeLogo', 'homeScore',
  'away', 'awayLogo', 'awayScore',
  'startTime', 'source',
  'homeId', 'awayId', 'tournamentId', 'seasonId',
];

/* ========================================================================== */
/*                               BOOTSTRAP / SETUP                             */
/* ========================================================================== */

function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Settings
  let settings = ss.getSheetByName(SHEET_SETTINGS);
  if (!settings) settings = ss.insertSheet(SHEET_SETTINGS);
  settings.clear();
  settings.getRange(1, 1, 1, 3)
    .setValues([['key', 'value', 'description']]).setFontWeight('bold');
  settings.getRange(2, 1, SETTINGS_DEFAULTS.length, 3).setValues(SETTINGS_DEFAULTS);
  settings.setFrozenRows(1);
  settings.autoResizeColumns(1, 3);

  // LiveScore
  let live = ss.getSheetByName(SHEET_LIVESCORE);
  if (!live) live = ss.insertSheet(SHEET_LIVESCORE);
  live.clear();
  live.getRange(1, 1, 1, LIVESCORE_COLUMNS.length)
    .setValues([LIVESCORE_COLUMNS]).setFontWeight('bold');
  live.setFrozenRows(1);

  // MatchDetails (cache dài hạn JSON đội hình / thống kê)
  let md = ss.getSheetByName(SHEET_MATCHDETAILS);
  if (!md) md = ss.insertSheet(SHEET_MATCHDETAILS);
  md.clear();
  md.getRange(1, 1, 1, 3)
    .setValues([['matchId', 'updatedAt', 'payload']]).setFontWeight('bold');
  md.setFrozenRows(1);

  // TeamDaily (snapshot dữ liệu đội theo ngày)
  let td = ss.getSheetByName(SHEET_TEAM_DAILY);
  if (!td) td = ss.insertSheet(SHEET_TEAM_DAILY);
  td.clear();
  td.getRange(1, 1, 1, 5)
    .setValues([['date', 'teamId', 'teamName', 'updatedAt', 'payload']]).setFontWeight('bold');
  td.setFrozenRows(1);

  // Standings (cache BXH giải đấu, key = tournamentId:seasonId)
  let st = ss.getSheetByName(SHEET_STANDINGS);
  if (!st) st = ss.insertSheet(SHEET_STANDINGS);
  st.clear();
  st.getRange(1, 1, 1, 4)
    .setValues([['key', 'tournamentId', 'updatedAt', 'payload']]).setFontWeight('bold');
  st.setFrozenRows(1);

  // TopPlayers (cache vua phá lưới/kiến tạo theo giải, key = tournamentId:seasonId:category)
  let tp = ss.getSheetByName(SHEET_TOPPLAYERS);
  if (!tp) tp = ss.insertSheet(SHEET_TOPPLAYERS);
  tp.clear();
  tp.getRange(1, 1, 1, 5)
    .setValues([['key', 'tournamentId', 'category', 'updatedAt', 'payload']]).setFontWeight('bold');
  tp.setFrozenRows(1);

  // TournamentInfo (cache thông tin giải đấu: logo, category, season hiện tại,...)
  let ti = ss.getSheetByName(SHEET_TOURNAMENTS);
  if (!ti) ti = ss.insertSheet(SHEET_TOURNAMENTS);
  ti.clear();
  ti.getRange(1, 1, 1, 5)
    .setValues([['tournamentId', 'slug', 'name', 'updatedAt', 'payload']]).setFontWeight('bold');
  ti.setFrozenRows(1);

  fetchSportsData();
}

/**
 * Chỉ setup tab Settings, KHÔNG đụng các tab dữ liệu crawl khác.
 * - Tạo tab Settings nếu chưa có.
 * - Bổ sung các key mặc định còn thiếu.
 * - Không ghi đè value hiện tại.
 */
function setupSettingsOnly() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let settings = ss.getSheetByName(SHEET_SETTINGS);
  if (!settings) settings = ss.insertSheet(SHEET_SETTINGS);

  // Nếu sheet trống hoàn toàn -> tạo header.
  if (settings.getLastRow() < 1 || settings.getLastColumn() < 3) {
    settings.clear();
    settings.getRange(1, 1, 1, 3)
      .setValues([['key', 'value', 'description']]).setFontWeight('bold');
    settings.setFrozenRows(1);
  }

  // Đọc các key hiện có để chỉ append key còn thiếu.
  const lastRow = settings.getLastRow();
  const existingRows = lastRow > 1 ? settings.getRange(2, 1, lastRow - 1, 3).getValues() : [];
  const existingMap = {};
  existingRows.forEach(function (r, i) {
    const key = String(r[0] || '').trim();
    if (!key) return;
    existingMap[key] = { rowIndex: i + 2, value: r[1], description: r[2] };
  });

  let appended = 0;
  SETTINGS_DEFAULTS.forEach(function (d) {
    const key = d[0];
    const value = d[1];
    const description = d[2];
    if (!existingMap[key]) {
      settings.appendRow([key, value, description]);
      appended += 1;
      return;
    }

    // Có key rồi nhưng mô tả đang trống thì tự điền mô tả.
    if (String(existingMap[key].description || '').trim() === '') {
      settings.getRange(existingMap[key].rowIndex, 3).setValue(description);
    }
  });

  settings.setFrozenRows(1);
  settings.autoResizeColumns(1, 3);
  return { ok: true, appended: appended, totalDefaults: SETTINGS_DEFAULTS.length };
}

const SETTINGS_DEFAULTS = [
  ['site_name', 'Mega Hub', 'Tên hiển thị của website'],
  ['site_tagline', 'Đa tiện ích – Siêu tốc độ', 'Slogan ngắn'],
  ['meta_title', 'Mega Hub – Live Score & Tiện ích online', 'SEO title'],
  ['meta_description', 'Cập nhật tỉ số trực tiếp, thống kê bóng đá và các tiện ích online miễn phí.', 'SEO description'],
  ['meta_keywords', 'livescore, bong da, ty so truc tiep', 'SEO keywords'],
  ['primary_color', '#22d3ee', 'Màu chủ đạo (hex)'],
  ['accent_color', '#f59e0b', 'Màu nhấn (hex)'],
  ['announcement', 'Live score cập nhật 60s/lần · Click vào trận để xem đội hình + thống kê.', 'Thông báo header'],
  ['announcement_enabled', 'true', 'Bật/tắt thông báo (true|false)'],
  ['maintenance_mode', 'false', 'Bật chế độ bảo trì (true|false)'],
  ['ads_enabled', 'true', 'Bật/tắt toàn bộ quảng cáo (true|false)'],
  ['adsense_client', 'ca-pub-XXXXXXXXXXXXXXXX', 'Google AdSense Publisher ID'],
  ['ads_slot_header_enabled', 'true', 'Bật/tắt slot header'],
  ['ads_slot_header', '1111111111', 'Slot quảng cáo dưới header'],
  ['ads_slot_inline_enabled', 'true', 'Bật/tắt slot inline'],
  ['ads_slot_inline', '2222222222', 'Slot quảng cáo giữa danh sách trận'],
  ['ads_slot_sidebar_enabled', 'true', 'Bật/tắt slot sidebar'],
  ['ads_slot_sidebar', '3333333333', 'Slot quảng cáo sidebar'],
  ['ads_slot_footer_enabled', 'true', 'Bật/tắt slot footer'],
  ['ads_slot_footer', '4444444444', 'Slot quảng cáo footer'],
  ['poll_interval_ms', '60000', 'Chu kỳ fetch LiveScore (ms)'],
  ['max_matches', '200', 'Số trận tối đa ghi vào sheet mỗi lần crawl'],
  ['max_matches_per_league', '4', 'Giới hạn số trận cùng 1 giải đấu (để đa dạng giải)'],
  ['schedule_days_back', '1', 'Số ngày lùi về (quá khứ) khi quét lịch thi đấu'],
  ['schedule_days_forward', '2', 'Số ngày tới (tương lai) khi quét lịch thi đấu'],
  ['featured_leagues', 'UEFA Super Cup|V-League 1|ASEAN Championship|FIFA World Cup|UEFA Champions League|Premier League|LaLiga|Serie A|Bundesliga|Ligue 1|AFC Asian Cup|AFC Champions League Elite|EURO|UEFA Europa League|UEFA Conference League|UEFA Nations League|FA Cup|Saudi Pro League|World Cup Qual. AFC', 'Thứ tự ưu tiên giải đấu trên app (đồng bộ từ SofaScore VN), phân tách bằng ký tự |'],
  ['featured_tournament_ids', '465|626|602|16|7|17|8|23|35|34|246|463|1|679|17015|10783|19|955|308', 'Thứ tự uniqueTournamentId giải mặc định (đồng bộ từ SofaScore VN)'],
  ['featured_league_limit', '12', 'Số lượng logo giải mặc định hiển thị trên app'],
  ['daily_finished_limit', '120', 'Số trận FT tối đa crawl mỗi ngày'],
  ['daily_team_limit', '150', 'Số đội tối đa snapshot mỗi ngày'],
  ['team_cache_ttl_days', '2', 'TTL (ngày) đọc snapshot TeamDaily từ sheet mà không crawl lại'],
  ['league_crawl_default_limit', '30', 'Số đội tối đa mỗi lần crawl theo giải đấu'],
  ['top_players_enabled', 'true', 'Bật panel Top Player (vua phá lưới) trên Sport Hub'],
  ['top_players_ttl_hours', '12', 'TTL cache TopPlayers (giờ) trước khi crawl lại'],
  ['top_players_limit', '5', 'Số cầu thủ hiển thị trong panel Top Player'],
  ['top_leagues_n', '8', 'Số giải hàng đầu mặc định khi crawl hàng loạt'],
  ['tournament_info_ttl_days', '7', 'TTL (ngày) cache TournamentInfo trước khi crawl lại'],
  ['football_api_key', '', '(tuỳ chọn) API-Football key – nếu trống sẽ dùng SofaScore'],
];

/* ========================================================================== */
/*                                    HTTP API                                 */
/* ========================================================================== */

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};

    if (params.teamId) {
      const teamId = String(params.teamId);
      const tournamentId = params.tournamentId ? String(params.tournamentId) : '';
      const seasonId = params.seasonId ? String(params.seasonId) : '';
      const detail = getTeamOverview_(teamId, tournamentId, seasonId);
      return jsonResponse_({ ok: true, ts: Date.now(), teamId: teamId, detail: detail });
    }

    if (params.matchId) {
      const id = String(params.matchId);
      const status = params.status ? String(params.status) : '';
      const detail = getMatchDetail_(id, status);
      return jsonResponse_({ ok: true, ts: Date.now(), matchId: id, detail: detail });
    }

    if (params.topPlayers || params.topPlayer) {
      const tournamentId = String(params.tournamentId || '');
      const seasonId = params.seasonId ? String(params.seasonId) : '';
      const category = params.category ? String(params.category) : 'goals';
      const limit = params.limit ? Math.max(1, Math.min(50, parseInt(params.limit, 10) || 5)) : 0;
      const detail = getTopPlayers_(tournamentId, seasonId, category, { limit: limit });
      return jsonResponse_({
        ok: true,
        ts: Date.now(),
        tournamentId: tournamentId,
        seasonId: detail._seasonId || seasonId,
        category: category,
        detail: detail,
      });
    }

    if (params.defaultLeagues || params.defaultLeaguesVN) {
      const locale = String(params.locale || 'VN');
      const list = fetchDefaultUniqueTournaments_(locale);
      return jsonResponse_({ ok: true, ts: Date.now(), locale: locale, items: list });
    }

    if (params.tournamentInfo) {
      const tournamentId = String(params.tournamentId || '');
      const info = getTournamentInfo_(tournamentId);
      return jsonResponse_({ ok: true, ts: Date.now(), tournamentId: tournamentId, detail: info });
    }

    if (params.topLeagues) {
      const n = Math.max(1, Math.min(50, parseInt(params.n, 10) || 0));
      const items = resolveTopLeagueIds_(n || undefined).map(function (id) {
        const info = getTournamentInfo_(id) || {};
        const countryName = info.country || (info.category && info.category.name) || '';
        const categorySlug = (info.category && info.category.slug) || '';
        const alpha2 = (info.category && info.category.alpha2) || '';
        return {
          tournamentId: id,
          name: info.name || '',
          display: buildLeagueDisplay_(info.name || '', countryName, categorySlug, alpha2),
          slug: info.slug || '',
          logo: info.logo || '',
          primaryColorHex: info.primaryColorHex || '',
          currentSeasonId: info.currentSeasonId || '',
          country: countryName,
          categorySlug: categorySlug,
          categoryAlpha2: alpha2,
        };
      });
      return jsonResponse_({ ok: true, ts: Date.now(), items: items });
    }

    return jsonResponse_({
      ok: true,
      ts: Date.now(),
      settings: readSettings_(),
      liveScore: readLiveScore_(),
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err), where: stackHint_(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.token !== ADMIN_TOKEN) return jsonResponse_({ ok: false, error: 'Unauthorized' });

    const action = body.action || 'updateSettings';
    if (action === 'updateSettings') {
      writeSettings_(body.settings || {});
      return jsonResponse_({ ok: true, updated: Object.keys(body.settings || {}).length });
    }
    if (action === 'refreshSports') {
      const result = fetchSportsData();
      return jsonResponse_({ ok: true, refreshed: true, ...result });
    }
    if (action === 'setupSettingsOnly') {
      const result = setupSettingsOnly();
      return jsonResponse_({ ok: true, ...result });
    }
    if (action === 'crawlFinishedDetails') {
      const limit = Number(body.limit) || 30;
      const result = crawlFinishedMatchDetails_(limit);
      return jsonResponse_({ ok: true, ...result });
    }
    if (action === 'resetBlacklist') {
      const removed = resetHostBlacklist_();
      return jsonResponse_({ ok: true, removed: removed });
    }
    if (action === 'normalizeSheets') {
      const result = normalizeAllSheets();
      return jsonResponse_({ ok: true, ...result });
    }
    if (action === 'crawlTeamsByLeague') {
      const tId = String(body.tournamentId || '');
      const sId = String(body.seasonId || '');
      if (!tId) return jsonResponse_({ ok: false, error: 'tournamentId required' });
      const result = crawlTeamsByLeague_(tId, sId, {
        limit: body.limit,
        forceRefresh: !!body.forceRefresh,
      });
      return jsonResponse_({ ok: true, ...result });
    }
    if (action === 'crawlTeamsByIds') {
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return jsonResponse_({ ok: false, error: 'items required' });
      const result = crawlTeamsByIds_(items, { forceRefresh: !!body.forceRefresh });
      return jsonResponse_({ ok: true, ...result });
    }
    if (action === 'seedFeaturedFromSofa') {
      const locale = String(body.locale || 'VN');
      const result = seedFeaturedFromSofa_(locale);
      return jsonResponse_({ ok: true, ...result });
    }
    if (action === 'crawlTopPlayers') {
      const tId = String(body.tournamentId || '');
      const sId = String(body.seasonId || '');
      if (!tId) return jsonResponse_({ ok: false, error: 'tournamentId required' });
      const categories = Array.isArray(body.categories) && body.categories.length
        ? body.categories
        : ['goals', 'assists', 'rating'];
      const result = crawlTopPlayersMulti_(tId, sId, categories, { forceRefresh: !!body.forceRefresh });
      return jsonResponse_({ ok: true, ...result });
    }
    if (action === 'crawlTournamentInfo') {
      const tId = String(body.tournamentId || '');
      if (!tId) return jsonResponse_({ ok: false, error: 'tournamentId required' });
      const result = crawlTournamentInfoFresh_(tId);
      return jsonResponse_({ ok: true, tournamentId: tId, detail: result });
    }
    if (action === 'crawlTopLeaguesInfo') {
      const n = Number(body.n) || 0;
      const result = crawlTournamentInfoTopLeagues_(n, { forceRefresh: !!body.forceRefresh });
      return jsonResponse_({ ok: true, ...result });
    }
    if (action === 'crawlTopLeaguesTeams') {
      const n = Number(body.n) || 0;
      const result = crawlTeamsTopLeagues_(n, {
        teamLimit: Number(body.teamLimit) || 0,
        forceRefresh: !!body.forceRefresh,
      });
      return jsonResponse_({ ok: true, ...result });
    }
    if (action === 'crawlTopLeaguesTopPlayers') {
      const n = Number(body.n) || 0;
      const categories = Array.isArray(body.categories) && body.categories.length
        ? body.categories
        : ['goals', 'assists', 'rating'];
      const result = crawlTopPlayersTopLeagues_(n, {
        categories: categories,
        forceRefresh: !!body.forceRefresh,
      });
      return jsonResponse_({ ok: true, ...result });
    }
    if (action === 'crawlTopLeaguesAll') {
      const n = Number(body.n) || 0;
      const result = crawlAllTopLeagues_(n, {
        teamLimit: Number(body.teamLimit) || 0,
        categories: Array.isArray(body.categories) && body.categories.length
          ? body.categories
          : ['goals', 'assists'],
        forceRefresh: !!body.forceRefresh,
      });
      return jsonResponse_({ ok: true, ...result });
    }
    return jsonResponse_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err), where: stackHint_(err) });
  }
}

function doOptions() {
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.JSON);
}

/* ========================================================================== */
/*                               SHEETS HELPERS                                */
/* ========================================================================== */

function readSettings_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS);
  if (!sh) return {};
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return {};
  const rows = sh.getRange(2, 1, lastRow - 1, 3).getValues();
  const out = {};
  rows.forEach(function (r) {
    const k = String(r[0] || '').trim();
    if (k) out[k] = castValue_(r[1]);
  });
  return out;
}

function writeSettings_(updates) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_SETTINGS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_SETTINGS);
    sh.getRange(1, 1, 1, 3).setValues([['key', 'value', 'description']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const lastRow = sh.getLastRow();
  const existing = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, 3).getValues() : [];
  const idx = {};
  existing.forEach(function (r, i) { idx[String(r[0]).trim()] = i; });

  Object.keys(updates).forEach(function (k) {
    if (idx.hasOwnProperty(k)) sh.getRange(idx[k] + 2, 2).setValue(updates[k]);
    else sh.appendRow([k, updates[k], '']);
  });
}

function readLiveScore_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LIVESCORE);
  if (!sh) return [];
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return rows.map(function (r) {
    const obj = {};
    headers.forEach(function (h, i) { obj[String(h)] = r[i]; });
    return obj;
  });
}

function writeLiveScore_(matches) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_LIVESCORE);
  if (!sh) sh = ss.insertSheet(SHEET_LIVESCORE);

  if (sh.getLastRow() < 1 || sh.getLastColumn() < LIVESCORE_COLUMNS.length) {
    sh.clear();
    sh.getRange(1, 1, 1, LIVESCORE_COLUMNS.length)
      .setValues([LIVESCORE_COLUMNS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
  if (!matches.length) return;

  const rows = matches.map(function (m) {
    return LIVESCORE_COLUMNS.map(function (c) { return m[c] == null ? '' : m[c]; });
  });
  sh.getRange(2, 1, rows.length, LIVESCORE_COLUMNS.length).setValues(rows);
}

function readMatchDetailFromSheet_(id) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MATCHDETAILS);
  if (!sh) return null;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const rows = sh.getRange(2, 1, lastRow - 1, 3).getValues();
  const target = String(id || '').trim();
  let best = null;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === target) {
      try {
        const payload = JSON.parse(rows[i][2] || '{}');
        const updatedAt = Number(rows[i][1]) || 0;
        if (!best || updatedAt > best.updatedAt) best = { updatedAt: updatedAt, payload: payload };
      } catch (_) { /* skip */ }
    }
  }
  return best;
}

function writeMatchDetailToSheet_(id, payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_MATCHDETAILS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_MATCHDETAILS);
    sh.getRange(1, 1, 1, 3).setValues([['matchId', 'updatedAt', 'payload']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.getRange('A:A').setNumberFormat('@');
  const lastRow = sh.getLastRow();
  const rows = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, 1).getValues() : [];
  const normId = String(id || '').trim();
  const now = Date.now();
  const json = JSON.stringify(payload);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === normId) {
      sh.getRange(i + 2, 2, 1, 2).setValues([[now, json]]);
      return;
    }
  }
  sh.appendRow([normId, now, json]);
  // Gọn sheet: chỉ giữ 500 dòng gần nhất
  const total = sh.getLastRow();
  if (total > 501) sh.deleteRows(2, total - 501);
}

/* ========================================================================== */
/*                               CRAWLERS – LIST                                */
/* ========================================================================== */

/**
 * Crawl TẤT CẢ trận đấu đang LIVE / sắp diễn ra trong ngày (mọi giải).
 * Thứ tự ưu tiên:
 *   1) SofaScore (không cần key).
 *   2) API-Football (nếu user nhập key).
 *   3) Rỗng – vẫn ghi sheet trống, không crash.
 */
function fetchSportsData() {
  const settings = readSettings_();
  const max = Number(settings.max_matches) || 200;
  const maxPerLeague = Number(settings.max_matches_per_league) || 4;
  const daysBack = Number(settings.schedule_days_back);
  const daysForward = Number(settings.schedule_days_forward);
  const back = Number.isFinite(daysBack) && daysBack >= 0 ? daysBack : 1;
  const fwd = Number.isFinite(daysForward) && daysForward >= 0 ? daysForward : 2;

  let raw = [];
  const errors = [];
  let sourceUsed = '';
  try {
    const live = crawlSofaLive_();
    raw = raw.concat(live);
    if (live.length > 0) sourceUsed = 'sofa-live';
  } catch (err) {
    const msg = 'Sofa LIVE failed: ' + err;
    Logger.log(msg);
    errors.push(msg);
  }

  // Quét LỊCH nhiều ngày để thu đa dạng giải đấu.
  try {
    const scheduled = crawlSofaScheduledMulti_(back, fwd);
    const seen = {};
    raw.forEach(function (m) { seen[m.id] = true; });
    scheduled.forEach(function (m) { if (!seen[m.id]) { seen[m.id] = true; raw.push(m); } });
    if (scheduled.length > 0 && !sourceUsed) sourceUsed = 'sofa-scheduled-multi';
  } catch (err) {
    const msg = 'Sofa SCHEDULED multi failed: ' + err;
    Logger.log(msg);
    errors.push(msg);
  }

  // Lọc đa dạng theo giải để tránh 1 giải chiếm hết chỗ.
  let matches = pickDiverseMatches_(raw, max, maxPerLeague);

  if (!matches.length && settings.football_api_key) {
    try {
      matches = crawlApiFootballLive_(settings.football_api_key).slice(0, max);
      if (matches.length > 0) sourceUsed = 'api-football-live';
    } catch (err) {
      const msg = 'API-Football failed: ' + err;
      Logger.log(msg);
      errors.push(msg);
    }
  }

  // Fallback công khai khi SofaScore chặn 403 và chưa có API-Football key.
  if (!matches.length) {
    try {
      matches = crawlSportsDbLive_().slice(0, max);
      if (matches.length > 0) sourceUsed = 'sportsdb-live';
    } catch (err) {
      const msg = 'SportsDB LIVE failed: ' + err;
      Logger.log(msg);
      errors.push(msg);
    }
  }

  if (matches.length < max) {
    try {
      const more = crawlSportsDbScheduled_(max - matches.length);
      const seen = {};
      matches.forEach(function (m) { seen[m.id] = true; });
      more.forEach(function (m) { if (!seen[m.id]) matches.push(m); });
      if (more.length > 0 && !sourceUsed) sourceUsed = 'sportsdb-scheduled';
    } catch (err) {
      const msg = 'SportsDB SCHEDULED failed: ' + err;
      Logger.log(msg);
      errors.push(msg);
    }
  }

  // Không làm hỏng data hiện có: nếu tất cả nguồn fail thì giữ nguyên sheet cũ.
  if (!matches.length) {
    const current = readLiveScore_();
    if (current && current.length) {
      return {
        totalMatches: current.length,
        source: 'preserved-existing',
        hasErrors: true,
        warnings: errors.concat(['All sources failed; preserved existing LiveScore data.']),
      };
    }

    // Sheet trống hoàn toàn + nguồn đều fail -> fallback mock để app vẫn hoạt động.
    matches = buildEmergencyMockMatches_(max);
    sourceUsed = 'emergency-mock';
    errors.push('All sources failed; used emergency mock data.');
  }

  writeLiveScore_(matches.slice(0, max));
  return {
    totalMatches: matches.slice(0, max).length,
    source: sourceUsed || 'unknown',
    hasErrors: errors.length > 0,
    warnings: errors,
  };
}

function buildEmergencyMockMatches_(max) {
  const fixtures = [
    { league: 'Premier League', country: 'England', home: 'Arsenal', away: 'Chelsea' },
    { league: 'Premier League', country: 'England', home: 'Liverpool', away: 'Man City' },
    { league: 'La Liga', country: 'Spain', home: 'Real Madrid', away: 'Barcelona' },
    { league: 'Serie A', country: 'Italy', home: 'Juventus', away: 'Inter Milan' },
    { league: 'Bundesliga', country: 'Germany', home: 'Bayern', away: 'Dortmund' },
    { league: 'V-League', country: 'Vietnam', home: 'HAGL', away: 'Hà Nội FC' },
    { league: 'Ligue 1', country: 'France', home: 'PSG', away: 'Marseille' },
    { league: 'Serie A', country: 'Italy', home: 'Napoli', away: 'Roma' },
  ];
  const now = new Date();
  const list = fixtures.slice(0, Math.max(1, Math.min(max || 8, fixtures.length)));
  return list.map(function (f, i) {
    return {
      id: 'mock-' + (1000 + i),
      league: f.league,
      leagueDisplay: buildLeagueDisplay_(f.league, f.country, '', ''),
      leagueLogo: '',
      country: f.country,
      categorySlug: '',
      categoryAlpha2: '',
      status: i % 4 === 0 ? 'HT' : 'LIVE',
      minute: (15 + i * 7) % 90,
      home: f.home,
      homeLogo: '',
      homeScore: Math.floor(Math.random() * 4),
      away: f.away,
      awayLogo: '',
      awayScore: Math.floor(Math.random() * 4),
      startTime: now.toISOString(),
      source: 'mock',
      homeId: '',
      awayId: '',
      tournamentId: '',
      seasonId: '',
    };
  });
}

function crawlSofaLive_() {
  const data = sofaFetch_('/sport/football/events/live');
  const events = data.events || [];
  return events.map(normalizeSofaEvent_);
}

function crawlSofaScheduled_(limit) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const data = sofaFetch_('/sport/football/scheduled-events/' + y + '-' + m + '-' + day);
  const events = data.events || [];
  const list = events.map(normalizeSofaEvent_);
  return limit ? list.slice(0, limit) : list;
}

/**
 * Lấy lịch thi đấu trải nhiều ngày (để đa dạng giải đấu hiển thị).
 * daysBack >=0, daysForward >=0. Trả về danh sách đã normalize + dedup theo event id.
 * KHÔNG throw nếu một ngày lỗi, chỉ bỏ qua.
 */
function crawlSofaScheduledMulti_(daysBack, daysForward) {
  const back = Math.max(0, Number(daysBack) || 0);
  const fwd = Math.max(0, Number(daysForward) || 0);
  const out = [];
  const seen = {};
  for (let i = -back; i <= fwd; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const data = safeSofa_('/sport/football/scheduled-events/' + y + '-' + m + '-' + day);
    const events = (data && data.events) || [];
    events.forEach(function (ev) {
      if (!ev || seen[ev.id]) return;
      seen[ev.id] = true;
      out.push(normalizeSofaEvent_(ev));
    });
  }
  return out;
}

/**
 * Lọc giữ sự đa dạng giải đấu:
 *   - Mỗi giải tối đa `maxPerLeague` trận.
 *   - Ưu tiên LIVE > HT > NS > FT.
 *   - Tối đa `max` trận.
 */
function pickDiverseMatches_(matches, max, maxPerLeague) {
  const limitTotal = Math.max(1, Number(max) || 100);
  const limitLeague = Math.max(1, Number(maxPerLeague) || 4);

  const priority = function (m) {
    const s = String(m.status || '').toUpperCase();
    if (s === 'LIVE') return 0;
    if (s === 'HT') return 1;
    if (s === 'NS') return 2;
    return 3; // FT/AET/PEN/...
  };
  const byPrio = matches.slice().sort(function (a, b) {
    const p = priority(a) - priority(b);
    if (p !== 0) return p;
    return String(a.startTime || '').localeCompare(String(b.startTime || ''));
  });

  const out = [];
  const count = {};
  byPrio.forEach(function (m) {
    if (out.length >= limitTotal) return;
    const key = String(m.tournamentId || m.league || '').toLowerCase();
    count[key] = count[key] || 0;
    if (count[key] >= limitLeague) return;
    out.push(m);
    count[key] += 1;
  });
  return out;
}

function normalizeSofaEvent_(ev) {
  const t = ev.tournament || {};
  const cat = t.category || {};
  const statusType = (ev.status && ev.status.type) || '';
  const desc = (ev.status && ev.status.description) || '';
  let status = desc || statusType || '—';
  if (statusType === 'inprogress') status = 'LIVE';
  else if (statusType === 'finished') status = 'FT';
  else if (statusType === 'notstarted') status = 'NS';

  let minute = 0;
  if (ev.time && ev.time.currentPeriodStartTimestamp) {
    const now = Math.floor(Date.now() / 1000);
    minute = Math.max(0, Math.floor((now - ev.time.currentPeriodStartTimestamp) / 60) + (ev.time.initial || 0) / 60);
    minute = Math.min(130, Math.round(minute));
  }

  const tId = t.uniqueTournament && t.uniqueTournament.id;
  const leagueLogo = tId ? SOFA_IMG + '/unique-tournament/' + tId + '/image' : '';

  // Chỉ lấy tên của uniqueTournament (ví dụ: "Premier League"). Không dùng t.name vì
  // Sofa trả `t.name` = tên phụ giai đoạn ("Regular Season"), dễ nhầm giữa các giải.
  const baseName = (t.uniqueTournament && t.uniqueTournament.name) || t.name || 'Unknown';
  const countryName = cat.name || '';
  const categorySlug = cat.slug || '';
  const alpha2 = cat.alpha2 || '';
  const flag = cat.flag || '';
  const leagueDisplay = buildLeagueDisplay_(baseName, countryName, categorySlug, alpha2);

  return {
    id: ev.id,
    league: baseName,
    leagueDisplay: leagueDisplay,
    leagueLogo: leagueLogo,
    country: countryName,
    categorySlug: categorySlug,
    categoryAlpha2: alpha2,
    categoryFlag: flag,
    status: status,
    minute: status === 'LIVE' ? minute : 0,
    home: (ev.homeTeam && ev.homeTeam.name) || '',
    homeLogo: ev.homeTeam ? SOFA_IMG + '/team/' + ev.homeTeam.id + '/image' : '',
    homeScore: (ev.homeScore && (ev.homeScore.current != null ? ev.homeScore.current : ev.homeScore.display)) || 0,
    away: (ev.awayTeam && ev.awayTeam.name) || '',
    awayLogo: ev.awayTeam ? SOFA_IMG + '/team/' + ev.awayTeam.id + '/image' : '',
    awayScore: (ev.awayScore && (ev.awayScore.current != null ? ev.awayScore.current : ev.awayScore.display)) || 0,
    startTime: ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : '',
    source: 'sofa',
    homeId: ev.homeTeam && ev.homeTeam.id ? String(ev.homeTeam.id) : '',
    awayId: ev.awayTeam && ev.awayTeam.id ? String(ev.awayTeam.id) : '',
    tournamentId: tId ? String(tId) : '',
    seasonId: ev.season && ev.season.id ? String(ev.season.id) : '',
  };
}

/**
 * "Premier League" là tên được dùng chung ở rất nhiều nước (Anh, Nga, Belarus, Malaysia...).
 * Ghép thêm tên nước để người dùng phân biệt. Các giải quốc tế (Europe/World/Asia/International)
 * không có alpha2 -> giữ nguyên tên để tránh tiền tố thừa ("Europe · UEFA Champions League").
 */
function buildLeagueDisplay_(baseName, countryName, categorySlug, alpha2) {
  if (!baseName) return countryName || '';
  const INTL = ['europe', 'world', 'asia', 'africa', 'oceania', 'north-america', 'south-america', 'international'];
  const isIntl = !alpha2 && INTL.indexOf(String(categorySlug || '').toLowerCase()) >= 0;
  if (!countryName || isIntl) return baseName;
  // Nếu tên giải đã tự nhúng tên quốc gia (vd "Serie A Italy") thì không thêm nữa.
  if (new RegExp('(^|[^a-z])' + escapeRegExp_(countryName) + '([^a-z]|$)', 'i').test(baseName)) return baseName;
  return countryName + ' · ' + baseName;
}

function escapeRegExp_(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function crawlApiFootballLive_(apiKey) {
  const res = UrlFetchApp.fetch('https://v3.football.api-sports.io/fixtures?live=all', {
    method: 'get', muteHttpExceptions: true,
    headers: { 'x-apisports-key': apiKey },
  });
  const body = JSON.parse(res.getContentText() || '{}');
  const list = body.response || [];
  return list.map(function (it) {
    const countryName = it.league.country || '';
    const name = it.league.name || 'Unknown';
    return {
      id: it.fixture.id,
      league: name,
      leagueDisplay: buildLeagueDisplay_(name, countryName, '', ''),
      leagueLogo: it.league.logo || '',
      country: countryName,
      categorySlug: '',
      categoryAlpha2: '',
      status: it.fixture.status.short,
      minute: it.fixture.status.elapsed || 0,
      home: it.teams.home.name,
      homeLogo: it.teams.home.logo,
      homeScore: it.goals.home == null ? 0 : it.goals.home,
      away: it.teams.away.name,
      awayLogo: it.teams.away.logo,
      awayScore: it.goals.away == null ? 0 : it.goals.away,
      startTime: it.fixture.date,
      source: 'api-football',
      homeId: it.teams.home && it.teams.home.id ? String(it.teams.home.id) : '',
      awayId: it.teams.away && it.teams.away.id ? String(it.teams.away.id) : '',
      tournamentId: it.league && it.league.id ? String(it.league.id) : '',
      seasonId: it.league && it.league.season ? String(it.league.season) : '',
    };
  });
}

function crawlSportsDbLive_() {
  const data = httpJsonWithoutHeaders_(SPORTSDB + '/livescore.php?s=Soccer');
  const list = data && data.events ? data.events : [];
  return list.map(normalizeSportsDbEvent_);
}

function crawlSportsDbScheduled_(limit) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const date = y + '-' + m + '-' + day;
  const data = httpJsonWithoutHeaders_(SPORTSDB + '/eventsday.php?d=' + encodeURIComponent(date) + '&s=Soccer');
  const list = data && data.events ? data.events.slice(0, limit || 40) : [];
  return list.map(normalizeSportsDbEvent_);
}

function normalizeSportsDbEvent_(it) {
  const strStatus = String(it.strStatus || '').toUpperCase();
  const status = strStatus.includes('LIVE') ? 'LIVE' : (strStatus.includes('FT') || strStatus.includes('MATCH FINISHED')) ? 'FT' : 'NS';
  const eventId = it.idEvent || (it.strEvent ? String(it.strEvent) : ('sportsdb-' + Math.random()));
  const leagueName = it.strLeague || it.strLeagueAlternate || 'Unknown';

  const countryName = it.strCountry || '';
  return {
    id: String(eventId),
    league: leagueName,
    leagueDisplay: buildLeagueDisplay_(leagueName, countryName, '', ''),
    leagueLogo: it.strLeagueBadge || '',
    country: countryName,
    categorySlug: '',
    categoryAlpha2: '',
    status: status,
    minute: 0,
    home: it.strHomeTeam || '',
    homeLogo: it.strHomeTeamBadge || '',
    homeScore: toNum_(it.intHomeScore),
    away: it.strAwayTeam || '',
    awayLogo: it.strAwayTeamBadge || '',
    awayScore: toNum_(it.intAwayScore),
    startTime: it.strTimestamp || it.dateEvent ? new Date((it.strTimestamp || (it.dateEvent + 'T00:00:00Z'))).toISOString() : '',
    source: 'sportsdb',
    homeId: it.idHomeTeam ? String(it.idHomeTeam) : '',
    awayId: it.idAwayTeam ? String(it.idAwayTeam) : '',
    tournamentId: it.idLeague ? String(it.idLeague) : '',
    seasonId: it.strSeason ? String(it.strSeason) : '',
  };
}

/* ========================================================================== */
/*                            CRAWLERS – MATCH DETAIL                           */
/* ========================================================================== */

/**
 * Trả về chi tiết 1 trận.
 * Quy tắc "đã lưu thì không crawl lại":
 *   - Sheet `MatchDetails` chỉ chứa payload của trận FT/AET/PEN (ghi 1 lần duy nhất).
 *   - Nếu matchId đã có trong sheet -> trả ngay, KHÔNG gọi crawler.
 *   - Nếu chưa có: trận LIVE/NS thì crawl & cache 60s.
 *     Trận FT mà chưa có sheet (lần đầu) -> crawl & persist sheet (vĩnh viễn).
 * payload: { match, lineup, stats, incidents, standings, _cached }
 */
function getMatchDetail_(id, statusHint) {
  // 0) Sheet luôn là "nguồn sự thật" cho trận đã lưu – không quan tâm statusHint.
  const sheetCached = readMatchDetailFromSheet_(id);
  if (sheetCached && sheetCached.payload && !isPayloadEmpty_(sheetCached.payload)) {
    return Object.assign({}, sheetCached.payload, {
      _cached: 'sheet',
      _cachedAt: sheetCached.updatedAt || 0,
    });
  }

  // 1) Trận LIVE/NS: cache 60s trong CacheService để giảm tải.
  const cache = CacheService.getScriptCache();
  if (!isFinishedStatus_(statusHint)) {
    const cached = cache.get('md:' + id);
    if (cached) {
      try {
        const p = JSON.parse(cached);
        return Object.assign({}, p, { _cached: 'memory' });
      } catch (_) { /* fallthrough */ }
    }
  }

  // 2) Crawl 1 lần (không throw).
  let payload = null;
  try {
    payload = crawlSofaDetail_(id);
  } catch (err) {
    Logger.log('crawlSofaDetail_ failed for ' + id + ': ' + err);
  }

  if (!payload || isPayloadEmpty_(payload)) {
    // Crawl fail -> fallback shell từ LiveScore, rồi shell rỗng.
    const shell = buildMatchShellFromLiveScore_(id);
    if (shell) return shell;
    return buildEmptyMatchDetail_(id);
  }

  // 3) Trận FT (từ statusHint hoặc payload mới crawl) -> lưu VĨNH VIỄN vào sheet.
  //    Từ lần 2 trở đi sẽ bước vào (0) và không crawl nữa.
  const isFinished = isFinishedStatus_(statusHint || (payload.match && payload.match.status));
  if (isFinished) {
    try { writeMatchDetailToSheet_(id, payload); } catch (_) { /* noop */ }
    return Object.assign({}, payload, { _cached: 'fresh-ft' });
  }

  // 4) Trận LIVE/NS: cache ngắn hạn.
  try { cache.put('md:' + id, JSON.stringify(payload), 60); } catch (_) { /* noop */ }
  return Object.assign({}, payload, { _cached: 'fresh' });
}

function isPayloadEmpty_(p) {
  if (!p) return true;
  const hasLineup = !!(p.lineup && (p.lineup.home || p.lineup.away));
  const hasStats = !!(p.stats && p.stats.length);
  const hasInc = !!(p.incidents && p.incidents.length);
  const hasMatch = !!p.match;
  const hasStand = !!(p.standings && p.standings.length);
  return !hasLineup && !hasStats && !hasInc && !hasMatch && !hasStand;
}

function buildEmptyMatchDetail_(id) {
  return {
    match: null,
    lineup: null,
    stats: [],
    incidents: [],
    standings: [],
    _fallback: 'empty',
    _matchId: String(id || ''),
  };
}

function buildMatchShellFromLiveScore_(id) {
  try {
    const list = readLiveScore_();
    const m = list.find(function (x) { return String(x.id) === String(id); });
    if (!m) return null;
    const standings = (m.tournamentId && m.seasonId)
      ? readStandingsFromSheet_(String(m.tournamentId), String(m.seasonId))
      : [];
    return {
      match: m,
      lineup: null,
      stats: [],
      incidents: [],
      standings: standings || [],
      _fallback: 'livescore-shell',
    };
  } catch (_) { return null; }
}

function crawlFinishedMatchDetails_(limit) {
  const list = readLiveScore_();
  const finished = list
    .filter(function (m) { return isFinishedStatus_(m.status); })
    .slice(0, Math.max(1, limit));

  let ok = 0;
  let fail = 0;
  const errors = [];

  finished.forEach(function (m) {
    try {
      let payload = null;
      try { payload = crawlSofaDetail_(String(m.id)); }
      catch (innerErr) { Logger.log('crawlSofaDetail_ ' + m.id + ': ' + innerErr); }

      // Chỉ ghi đè khi crawl thành công thật, tránh phá payload cũ bằng dữ liệu rỗng.
      if (payload && !isPayloadEmpty_(payload)) {
        writeMatchDetailToSheet_(String(m.id), payload);
        ok += 1;
      } else {
        fail += 1;
        errors.push({ id: m.id, error: 'empty-or-failed' });
      }
    } catch (err) {
      fail += 1;
      errors.push({ id: m.id, error: String(err) });
    }
  });

  const summary = { crawled: finished.length, success: ok, failed: fail, errors: errors.slice(0, 5) };
  try { summary.normalized = normalizeMatchDetailsSheet_(); } catch (_) { /* noop */ }
  return summary;
}

/**
 * HÀM CHẠY HẰNG NGÀY #1:
 * Crawl chi tiết các trận đã kết thúc (FT/AET/PEN) và lưu vào MatchDetails.
 * Dùng để đặt trigger daily, ví dụ 01:00 AM.
 */
function crawlFinishedMatchesDaily() {
  const settings = readSettings_();
  const limit = Number(settings.daily_finished_limit) || 120;
  return crawlFinishedMatchDetails_(limit);
}

/**
 * HÀM CHẠY HẰNG NGÀY #2:
 * Snapshot dữ liệu đội bóng (profile + recent/upcoming/standings) theo ngày.
 * Lưu vào sheet TeamDaily.
 */
function crawlTeamsDaily() {
  const settings = readSettings_();
  const maxTeams = Number(settings.daily_team_limit) || 150;
  const matches = readLiveScore_();

  // Gom đội duy nhất từ LiveScore hiện có, kèm tournament/season để lấy BXH chuẩn.
  const teams = {};
  matches.forEach(function (m) {
    const tId = String(m.tournamentId || '');
    const sId = String(m.seasonId || '');
    const hId = String(m.homeId || '');
    const aId = String(m.awayId || '');
    if (hId) teams[hId] = teams[hId] || { teamId: hId, teamName: m.home || '', tournamentId: tId, seasonId: sId };
    if (aId) teams[aId] = teams[aId] || { teamId: aId, teamName: m.away || '', tournamentId: tId, seasonId: sId };
  });

  const entries = Object.keys(teams).slice(0, Math.max(1, maxTeams)).map(function (k) { return teams[k]; });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_TEAM_DAILY);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TEAM_DAILY);
    sh.getRange(1, 1, 1, 5)
      .setValues([['date', 'teamId', 'teamName', 'updatedAt', 'payload']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  const dateKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  let ok = 0;
  let fail = 0;
  const errors = [];

  entries.forEach(function (x) {
    try {
      const payload = getTeamOverview_(x.teamId, x.tournamentId, x.seasonId);
      const teamName = (payload && payload.team && payload.team.name) || x.teamName || '';
      // Chỉ ghi khi thật sự có data (không phải fallback shell) VÀ có teamName.
      const looksReal = payload && !payload._fallback
        && (payload.team || payload.recentMatches.length || payload.upcomingMatches.length || payload.standings.length);
      if (looksReal && teamName.trim()) {
        writeTeamDailySnapshot_(dateKey, String(x.teamId), teamName, payload);
        ok += 1;
      } else {
        fail += 1;
        errors.push({ teamId: x.teamId, error: 'fallback-empty-or-noname' });
      }
    } catch (err) {
      fail += 1;
      errors.push({ teamId: x.teamId, error: String(err) });
    }
  });

  const summary = {
    date: dateKey,
    teams: entries.length,
    success: ok,
    failed: fail,
    errors: errors.slice(0, 5),
  };
  try { summary.normalized = normalizeTeamDailySheet_(); } catch (_) { /* noop */ }
  return summary;
}

/**
 * Crawl toàn bộ đội của 1 giải đấu (tournamentId + seasonId).
 * - Lấy danh sách đội từ sheet Standings nếu có, ngược lại gọi getStandings_ (crawl + cache).
 * - Crawl từng đội qua getTeamOverview_ (đã tự ghi TeamDaily).
 * - Bỏ qua đội đã có snapshot còn tươi (respect team_cache_ttl_days) trừ khi forceRefresh.
 */
function crawlTeamsByLeague_(tournamentId, seasonId, opts) {
  const options = opts || {};
  const settings = readSettings_();
  const limit = Math.max(1, Number(options.limit) || Number(settings.league_crawl_default_limit) || 30);
  const ttlMs = (Number(settings.team_cache_ttl_days) || 2) * 24 * 60 * 60 * 1000;
  const forceRefresh = !!options.forceRefresh;

  let standings = readStandingsFromSheet_(String(tournamentId), String(seasonId));
  if (!standings.length) {
    try { standings = getStandings_(String(tournamentId), String(seasonId)); }
    catch (_) { standings = []; }
  }
  if (!standings.length) {
    return { tournamentId: String(tournamentId), seasonId: String(seasonId), teams: 0, success: 0, skipped: 0, failed: 0, errors: ['no standings'] };
  }

  const targets = standings
    .filter(function (r) { return r.teamId; })
    .slice(0, limit);

  let ok = 0;
  let skipped = 0;
  let fail = 0;
  const errors = [];

  targets.forEach(function (row) {
    try {
      if (!forceRefresh) {
        const snap = readLatestTeamDaily_(String(row.teamId));
        if (snap && snap.payload && (Date.now() - (snap.updatedAt || 0) <= ttlMs)) {
          skipped += 1;
          return;
        }
      }

      const payload = crawlTeamOverviewFresh_(String(row.teamId), String(tournamentId), String(seasonId));
      const name = (payload && payload.team && payload.team.name) || row.teamName || '';
      if (payload && !payload._fallback && name.trim()) {
        const dateKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        writeTeamDailySnapshot_(dateKey, String(row.teamId), name, payload);
        ok += 1;
      } else {
        fail += 1;
        errors.push({ teamId: row.teamId, error: 'fallback-or-empty' });
      }
    } catch (err) {
      fail += 1;
      errors.push({ teamId: row.teamId, error: String(err) });
    }
  });

  const summary = {
    tournamentId: String(tournamentId),
    seasonId: String(seasonId),
    teams: targets.length,
    success: ok,
    skipped: skipped,
    failed: fail,
    errors: errors.slice(0, 5),
  };
  try { summary.normalized = normalizeTeamDailySheet_(); } catch (_) { /* noop */ }
  return summary;
}

/**
 * Crawl danh sách teamId cụ thể (user truyền từ Admin).
 * items: [{ teamId, tournamentId?, seasonId?, teamName? }, ...]
 */
function crawlTeamsByIds_(items, opts) {
  const options = opts || {};
  const settings = readSettings_();
  const ttlMs = (Number(settings.team_cache_ttl_days) || 2) * 24 * 60 * 60 * 1000;
  const forceRefresh = !!options.forceRefresh;
  const list = (items || []).filter(function (x) { return x && x.teamId; });

  let ok = 0;
  let skipped = 0;
  let fail = 0;
  const errors = [];

  list.forEach(function (x) {
    try {
      if (!forceRefresh) {
        const snap = readLatestTeamDaily_(String(x.teamId));
        if (snap && snap.payload && (Date.now() - (snap.updatedAt || 0) <= ttlMs)) {
          skipped += 1;
          return;
        }
      }

      const payload = crawlTeamOverviewFresh_(String(x.teamId), String(x.tournamentId || ''), String(x.seasonId || ''));
      const name = (payload && payload.team && payload.team.name) || x.teamName || '';
      if (payload && !payload._fallback && name.trim()) {
        const dateKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        writeTeamDailySnapshot_(dateKey, String(x.teamId), name, payload);
        ok += 1;
      } else {
        fail += 1;
        errors.push({ teamId: x.teamId, error: 'fallback-or-empty' });
      }
    } catch (err) {
      fail += 1;
      errors.push({ teamId: x.teamId, error: String(err) });
    }
  });

  const summary = {
    total: list.length,
    success: ok,
    skipped: skipped,
    failed: fail,
    errors: errors.slice(0, 5),
  };
  try { summary.normalized = normalizeTeamDailySheet_(); } catch (_) { /* noop */ }
  return summary;
}

/**
 * Gọi trực tiếp SofaScore – bỏ qua cache sheet/ScriptCache. Chỉ dùng cho Admin crawl.
 * getTeamOverview_ thường đọc cache -> không dùng để "force refresh".
 */
function crawlTeamOverviewFresh_(teamId, tournamentId, seasonId) {
  const teamData = safeSofa_('/team/' + teamId);
  const lastEvents = safeSofa_('/team/' + teamId + '/events/last/0');
  const nextEvents = safeSofa_('/team/' + teamId + '/events/next/0');
  const standings = (tournamentId && seasonId) ? getStandings_(String(tournamentId), String(seasonId)) : [];

  const payload = {
    team: normalizeTeam_(teamData && teamData.team),
    recentMatches: normalizeTeamEvents_(lastEvents && lastEvents.events, 8),
    upcomingMatches: normalizeTeamEvents_(nextEvents && nextEvents.events, 5),
    standings: standings,
  };
  const isEmpty = !payload.team && !payload.recentMatches.length
    && !payload.upcomingMatches.length && !payload.standings.length;
  if (isEmpty) return Object.assign({}, payload, { _fallback: 'empty' });
  return payload;
}

function crawlSofaDetail_(id) {
  const match = safeSofa_('/event/' + id);
  const lineup = safeSofa_('/event/' + id + '/lineups');
  const stats = safeSofa_('/event/' + id + '/statistics');
  const incidents = safeSofa_('/event/' + id + '/incidents');
  const ev = match && match.event ? match.event : null;
  const tournamentId = ev && ev.tournament && ev.tournament.uniqueTournament ? ev.tournament.uniqueTournament.id : '';
  const seasonId = ev && ev.season ? ev.season.id : '';
  const standings = (tournamentId && seasonId) ? getStandings_(String(tournamentId), String(seasonId)) : [];

  return {
    match: ev ? normalizeSofaEvent_(ev) : null,
    lineup: lineup ? normalizeLineup_(lineup) : null,
    stats: stats ? normalizeStats_(stats) : null,
    incidents: incidents ? normalizeIncidents_(incidents) : [],
    standings: standings,
  };
}

function normalizeLineup_(data) {
  function side(s) {
    if (!s) return null;
    return {
      formation: s.formation || '',
      players: (s.players || []).map(function (p) {
        const info = p.player || {};
        const stat = p.statistics || {};
        return {
          id: info.id,
          name: info.name,
          shortName: info.shortName || info.name,
          position: p.position || info.position || '',
          shirt: p.shirtNumber || info.jerseyNumber || 0,
          substitute: !!p.substitute,
          captain: !!p.captain,
          rating: stat.rating || null,
          goals: stat.goals || 0,
          assists: stat.goalAssist || 0,
          yellowCards: stat.yellowCards || 0,
          redCards: stat.redCards || 0,
          minutesPlayed: stat.minutesPlayed || 0,
          photo: info.id ? SOFA_IMG + '/player/' + info.id + '/image' : '',
        };
      }),
      missingPlayers: (s.missingPlayers || []).map(function (mp) {
        return { name: mp.player && mp.player.name, reason: mp.reason, type: mp.type };
      }),
    };
  }
  return {
    confirmed: !!data.confirmed,
    home: side(data.home),
    away: side(data.away),
  };
}

function normalizeStats_(data) {
  // SofaScore trả về groups theo period. Ta gom tất vào 1 mảng phẳng cho FE.
  const list = data.statistics || [];
  const out = [];
  list.forEach(function (period) {
    (period.groups || []).forEach(function (g) {
      (g.statisticsItems || []).forEach(function (it) {
        out.push({
          period: period.period || 'ALL',
          group: g.groupName || '',
          name: it.name,
          home: it.home,
          away: it.away,
          homeValue: it.homeValue,
          awayValue: it.awayValue,
          compareCode: it.compareCode || 0,
        });
      });
    });
  });
  return out;
}

function normalizeIncidents_(data) {
  const list = data.incidents || [];
  return list.map(function (it) {
    return {
      type: it.incidentType || it.type,
      class: it.incidentClass || '',
      time: it.time,
      addedTime: it.addedTime || 0,
      isHome: !!it.isHome,
      text: it.text || '',
      player: it.player && it.player.name,
      assist: it.assist1 && it.assist1.name,
      homeScore: it.homeScore,
      awayScore: it.awayScore,
    };
  });
}

/**
 * Chiến lược:
 *   1) ScriptCache 90s (chống burst).
 *   2) Snapshot TeamDaily còn tươi (<= team_cache_ttl_days, mặc định 2 ngày) -> trả thẳng, KHÔNG crawl.
 *   3) Nếu miss / stale -> crawl SofaScore 1 lần, persist vào TeamDaily cho user kế tiếp đọc từ sheet.
 *   4) Crawl fail -> lấy snapshot cũ nhất / LiveScore shell / empty shell.
 */
function getTeamOverview_(teamId, tournamentId, seasonId) {
  const cache = CacheService.getScriptCache();
  const key = 'team:' + teamId + ':' + tournamentId + ':' + seasonId;
  const cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) { /* noop */ }
  }

  // Đọc snapshot TeamDaily. Nếu còn trong TTL -> trả về ngay.
  const settings = readSettings_();
  const ttlDays = Number(settings.team_cache_ttl_days);
  const ttlMs = (Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 2) * 24 * 60 * 60 * 1000;
  const snap = readLatestTeamDaily_(teamId);

  if (snap && snap.payload && (Date.now() - (snap.updatedAt || 0) <= ttlMs)) {
    const fresh = Object.assign({}, snap.payload, {
      _cached: 'sheet',
      _cachedAt: snap.updatedAt || 0,
    });
    try { cache.put(key, JSON.stringify(fresh), 90); } catch (_) { /* noop */ }
    return fresh;
  }

  // Crawl 1 lần (dùng safeSofa nên không throw, chỉ trả null nếu fail từng endpoint).
  const teamData = safeSofa_('/team/' + teamId);
  const lastEvents = safeSofa_('/team/' + teamId + '/events/last/0');
  const nextEvents = safeSofa_('/team/' + teamId + '/events/next/0');
  const standings = (tournamentId && seasonId) ? getStandings_(tournamentId, seasonId) : [];

  const payload = {
    team: normalizeTeam_(teamData && teamData.team),
    recentMatches: normalizeTeamEvents_(lastEvents && lastEvents.events, 8),
    upcomingMatches: normalizeTeamEvents_(nextEvents && nextEvents.events, 5),
    standings: standings,
  };

  const isEmpty = !payload.team && !payload.recentMatches.length
    && !payload.upcomingMatches.length && !payload.standings.length;

  if (isEmpty) {
    // Fallback 1: snapshot cũ hơn TTL (vẫn còn trong sheet) -> vẫn dùng được.
    if (snap && snap.payload) {
      return Object.assign({}, snap.payload, { _fallback: 'team-daily-stale', _cachedAt: snap.updatedAt || 0 });
    }
    // Fallback 2: dựng shell từ LiveScore.
    const shell = buildTeamShellFromLiveScore_(teamId);
    if (shell) return shell;
    return {
      team: { id: teamId, name: '', shortName: '', logo: SOFA_IMG + '/team/' + teamId + '/image' },
      recentMatches: [],
      upcomingMatches: [],
      standings: [],
      _fallback: 'empty',
    };
  }

  // Có data thật -> persist vào TeamDaily để user kế tiếp đọc thẳng từ sheet.
  const teamName = (payload.team && payload.team.name) || '';
  if (teamName.trim()) {
    try {
      const dateKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      writeTeamDailySnapshot_(dateKey, String(teamId), teamName, payload);
    } catch (_) { /* noop */ }
  }

  const result = Object.assign({}, payload, { _cached: 'fresh' });
  try { cache.put(key, JSON.stringify(result), 90); } catch (_) { /* noop */ }
  return result;
}

function buildTeamShellFromLiveScore_(teamId) {
  try {
    const list = readLiveScore_();
    let teamName = '';
    const tid = String(teamId);
    list.forEach(function (m) {
      if (String(m.homeId) === tid) teamName = teamName || m.home;
      if (String(m.awayId) === tid) teamName = teamName || m.away;
    });
    if (!teamName) return null;

    const recent = list
      .filter(function (m) { return String(m.homeId) === tid || String(m.awayId) === tid; })
      .map(function (m) {
        return {
          id: m.id, league: m.league, status: m.status, minute: m.minute || 0,
          home: m.home, away: m.away, homeScore: m.homeScore, awayScore: m.awayScore,
          startTime: m.startTime, homeId: m.homeId, awayId: m.awayId,
        };
      });

    return {
      team: {
        id: teamId, name: teamName, shortName: teamName, country: '', venue: '',
        manager: '', founded: '', logo: SOFA_IMG + '/team/' + teamId + '/image',
      },
      recentMatches: recent,
      upcomingMatches: [],
      standings: [],
      _fallback: 'livescore-shell',
    };
  } catch (_) { return null; }
}

function readLatestTeamDaily_(teamId) {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TEAM_DAILY);
    if (!sh) return null;
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return null;
    const rows = sh.getRange(2, 1, lastRow - 1, 5).getValues();
    let best = null;
    const targetId = String(teamId || '').trim();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][1]).trim() === targetId) {
        try {
          const payload = JSON.parse(rows[i][4] || '{}');
          const updatedAt = Number(rows[i][3]) || 0;
          if (!best || updatedAt > best.updatedAt) best = { updatedAt: updatedAt, payload: payload };
        } catch (_) { /* skip */ }
      }
    }
    return best;
  } catch (_) { return null; }
}

function normalizeTeam_(team) {
  if (!team) return null;
  return {
    id: team.id,
    name: team.name || '',
    shortName: team.shortName || team.name || '',
    country: team.country && team.country.name ? team.country.name : '',
    venue: team.venue && team.venue.name ? team.venue.name : '',
    manager: team.manager && team.manager.name ? team.manager.name : '',
    founded: team.founded || '',
    logo: team.id ? SOFA_IMG + '/team/' + team.id + '/image' : '',
  };
}

function normalizeTeamEvents_(events, limit) {
  const list = events || [];
  return list.slice(0, limit || 8).map(function (ev) {
    const n = normalizeSofaEvent_(ev);
    return {
      id: n.id,
      league: n.league,
      leagueDisplay: n.leagueDisplay,
      leagueLogo: n.leagueLogo,
      country: n.country,
      categorySlug: n.categorySlug,
      categoryAlpha2: n.categoryAlpha2,
      status: n.status,
      minute: n.minute,
      home: n.home,
      homeLogo: n.homeLogo,
      away: n.away,
      awayLogo: n.awayLogo,
      homeScore: n.homeScore,
      awayScore: n.awayScore,
      startTime: n.startTime,
      homeId: n.homeId,
      awayId: n.awayId,
      tournamentId: n.tournamentId,
      seasonId: n.seasonId,
    };
  });
}

function getStandings_(tournamentId, seasonId) {
  const key = String(tournamentId) + ':' + String(seasonId);
  const cache = CacheService.getScriptCache();
  const cacheKey = 'st:' + key;

  // 1) Script cache 10 phút
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) { /* fallthrough */ }
  }

  // 2) Crawl
  const data = safeSofa_('/unique-tournament/' + tournamentId + '/season/' + seasonId + '/standings/total');
  if (data && data.standings && data.standings.length) {
    const rows = data.standings[0].rows || [];
    const list = rows.map(function (r) {
      const team = r.team || {};
      return {
        rank: r.position || 0,
        teamId: team.id || '',
        teamName: team.name || '',
        teamLogo: team.id ? SOFA_IMG + '/team/' + team.id + '/image' : '',
        played: r.matches || 0,
        win: r.wins || 0,
        draw: r.draws || 0,
        loss: r.losses || 0,
        goalsFor: r.scoresFor || 0,
        goalsAgainst: r.scoresAgainst || 0,
        goalDiff: r.scoreDiff || 0,
        points: r.points || 0,
      };
    });

    if (list.length) {
      try { cache.put(cacheKey, JSON.stringify(list), 600); } catch (_) { /* noop */ }
      try { writeStandingsToSheet_(String(tournamentId), String(seasonId), list); } catch (_) { /* noop */ }
      return list;
    }
  }

  // 3) Fallback: đọc sheet Standings đã cache
  const fromSheet = readStandingsFromSheet_(String(tournamentId), String(seasonId));
  if (fromSheet && fromSheet.length) return fromSheet;

  return [];
}

function readStandingsFromSheet_(tournamentId, seasonId) {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STANDINGS);
    if (!sh) return [];
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return [];
    const rows = sh.getRange(2, 1, lastRow - 1, 4).getValues();
    const key = String(tournamentId) + ':' + String(seasonId);
    // Ưu tiên khớp chính xác key (tournament:season)
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === key) {
        try { return JSON.parse(rows[i][3] || '[]'); } catch (_) { return []; }
      }
    }
    // Dự phòng: chỉ khớp tournamentId (mùa giải khác nhưng vẫn hơn rỗng)
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][1]) === String(tournamentId)) {
        try { return JSON.parse(rows[i][3] || '[]'); } catch (_) { return []; }
      }
    }
    return [];
  } catch (_) { return []; }
}

function writeStandingsToSheet_(tournamentId, seasonId, list) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_STANDINGS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_STANDINGS);
    sh.getRange(1, 1, 1, 4)
      .setValues([['key', 'tournamentId', 'updatedAt', 'payload']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.getRange('A:A').setNumberFormat('@');
  sh.getRange('B:B').setNumberFormat('@');

  const key = String(tournamentId) + ':' + String(seasonId);
  const normTid = String(tournamentId || '').trim();
  const now = Date.now();
  const json = JSON.stringify(list);
  const lastRow = sh.getLastRow();
  const rows = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, 1).getValues() : [];
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      sh.getRange(i + 2, 2, 1, 3).setValues([[normTid, now, json]]);
      return;
    }
  }
  sh.appendRow([key, normTid, now, json]);
  // Gọn sheet: giữ 300 dòng
  const total = sh.getLastRow();
  if (total > 301) sh.deleteRows(2, total - 301);
}

function writeTeamDailySnapshot_(dateKey, teamId, teamName, payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_TEAM_DAILY);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TEAM_DAILY);
    sh.getRange(1, 1, 1, 5)
      .setValues([['date', 'teamId', 'teamName', 'updatedAt', 'payload']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  // Ép 2 cột khoá (date, teamId) về kiểu Plain Text để tránh Google Sheets tự parse thành Date/Number.
  sh.getRange('A:A').setNumberFormat('@');
  sh.getRange('B:B').setNumberFormat('@');

  const normDate = normalizeDateKey_(dateKey);
  const normTeamId = String(teamId || '').trim();
  const now = Date.now();
  const json = JSON.stringify(payload);
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    const rows = sh.getRange(2, 1, lastRow - 1, 2).getValues(); // date + teamId
    for (let i = 0; i < rows.length; i++) {
      if (normalizeDateKey_(rows[i][0]) === normDate && String(rows[i][1]).trim() === normTeamId) {
        sh.getRange(i + 2, 3, 1, 3).setValues([[teamName, now, json]]);
        return;
      }
    }
  }

  sh.appendRow([normDate, normTeamId, teamName, now, json]);

  // Giữ sheet gọn: tối đa 5000 dòng snapshot
  const total = sh.getLastRow();
  if (total > 5001) sh.deleteRows(2, total - 5001);
}

/* ========================================================================== */
/*                        NORMALIZE / DEDUPE SHEETS                             */
/* ========================================================================== */

/**
 * Dedupe toàn bộ 3 sheet cache: TeamDaily / MatchDetails / Standings.
 * - Với TeamDaily: key = date+teamId, giữ dòng có updatedAt mới nhất VÀ teamName không rỗng.
 * - Với MatchDetails: key = matchId, giữ dòng có updatedAt mới nhất.
 * - Với Standings: key = key column, giữ dòng có updatedAt mới nhất.
 * Chạy cuối các job daily hoặc Admin bấm nút.
 */
function normalizeAllSheets() {
  const result = {
    teamDaily: normalizeTeamDailySheet_(),
    matchDetails: normalizeMatchDetailsSheet_(),
    standings: normalizeStandingsSheet_(),
  };
  return result;
}

function normalizeTeamDailySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_TEAM_DAILY);
  if (!sh) return { removed: 0, total: 0 };
  const lastRow = sh.getLastRow();
  if (lastRow < 3) return { removed: 0, total: Math.max(0, lastRow - 1) };

  const data = sh.getRange(2, 1, lastRow - 1, 5).getValues();
  const bestByKey = {};
  // Chọn bản tốt nhất cho mỗi (date, teamId): ưu tiên có teamName, sau đó updatedAt cao nhất.
  data.forEach(function (row) {
    const date = normalizeDateKey_(row[0]);
    const teamId = String(row[1] || '').trim();
    if (!date || !teamId) return;
    const key = date + '|' + teamId;
    const teamName = String(row[2] || '').trim();
    const updatedAt = Number(row[3]) || 0;
    const payload = String(row[4] || '');

    const hasName = !!teamName;
    const current = bestByKey[key];
    if (!current) { bestByKey[key] = { date, teamId, teamName, updatedAt, payload, hasName }; return; }
    // Có tên thắng không tên
    if (hasName && !current.hasName) { bestByKey[key] = { date, teamId, teamName, updatedAt, payload, hasName }; return; }
    if (!hasName && current.hasName) return;
    // Cùng trạng thái tên -> lấy updatedAt lớn hơn
    if (updatedAt > current.updatedAt) bestByKey[key] = { date, teamId, teamName, updatedAt, payload, hasName };
  });

  // Sắp xếp lại: date desc, teamId asc
  const rows = Object.keys(bestByKey).map(function (k) { return bestByKey[k]; });
  rows.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return String(a.teamId).localeCompare(String(b.teamId));
  });

  // Ghi lại sheet với kiểu Plain Text cho 2 cột khoá.
  sh.getRange('A:A').setNumberFormat('@');
  sh.getRange('B:B').setNumberFormat('@');
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, 5).clearContent();
  if (rows.length) {
    const values = rows.map(function (r) { return [r.date, r.teamId, r.teamName, r.updatedAt, r.payload]; });
    sh.getRange(2, 1, values.length, 5).setValues(values);
  }

  return { removed: data.length - rows.length, total: rows.length };
}

function normalizeMatchDetailsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_MATCHDETAILS);
  if (!sh) return { removed: 0, total: 0 };
  const lastRow = sh.getLastRow();
  if (lastRow < 3) return { removed: 0, total: Math.max(0, lastRow - 1) };

  const data = sh.getRange(2, 1, lastRow - 1, 3).getValues();
  const bestById = {};
  data.forEach(function (row) {
    const id = String(row[0] || '').trim();
    if (!id) return;
    const updatedAt = Number(row[1]) || 0;
    const payload = String(row[2] || '');
    // Ưu tiên payload có content (>2 ký tự để loại '{}')
    const looksReal = payload.length > 10;
    const current = bestById[id];
    if (!current) { bestById[id] = { id, updatedAt, payload, looksReal }; return; }
    if (looksReal && !current.looksReal) { bestById[id] = { id, updatedAt, payload, looksReal }; return; }
    if (!looksReal && current.looksReal) return;
    if (updatedAt > current.updatedAt) bestById[id] = { id, updatedAt, payload, looksReal };
  });

  const rows = Object.keys(bestById).map(function (k) { return bestById[k]; });
  rows.sort(function (a, b) { return b.updatedAt - a.updatedAt; });

  sh.getRange('A:A').setNumberFormat('@');
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, 3).clearContent();
  if (rows.length) {
    const values = rows.map(function (r) { return [r.id, r.updatedAt, r.payload]; });
    sh.getRange(2, 1, values.length, 3).setValues(values);
  }

  return { removed: data.length - rows.length, total: rows.length };
}

function normalizeStandingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_STANDINGS);
  if (!sh) return { removed: 0, total: 0 };
  const lastRow = sh.getLastRow();
  if (lastRow < 3) return { removed: 0, total: Math.max(0, lastRow - 1) };

  const data = sh.getRange(2, 1, lastRow - 1, 4).getValues();
  const bestByKey = {};
  data.forEach(function (row) {
    const key = String(row[0] || '').trim();
    if (!key) return;
    const tid = String(row[1] || '').trim();
    const updatedAt = Number(row[2]) || 0;
    const payload = String(row[3] || '');
    const looksReal = payload.length > 5;
    const current = bestByKey[key];
    if (!current) { bestByKey[key] = { key, tid, updatedAt, payload, looksReal }; return; }
    if (looksReal && !current.looksReal) { bestByKey[key] = { key, tid, updatedAt, payload, looksReal }; return; }
    if (!looksReal && current.looksReal) return;
    if (updatedAt > current.updatedAt) bestByKey[key] = { key, tid, updatedAt, payload, looksReal };
  });

  const rows = Object.keys(bestByKey).map(function (k) { return bestByKey[k]; });
  rows.sort(function (a, b) { return b.updatedAt - a.updatedAt; });

  sh.getRange('A:A').setNumberFormat('@');
  sh.getRange('B:B').setNumberFormat('@');
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, 4).clearContent();
  if (rows.length) {
    const values = rows.map(function (r) { return [r.key, r.tid, r.updatedAt, r.payload]; });
    sh.getRange(2, 1, values.length, 4).setValues(values);
  }

  return { removed: data.length - rows.length, total: rows.length };
}

/** Trả chuỗi yyyy-MM-dd từ Date object hoặc chuỗi bất kỳ. */
function normalizeDateKey_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v || '').trim();
  // Nếu đã là yyyy-MM-dd thì giữ nguyên, ngược lại thử parse.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return s;
}

/* ========================================================================== */
/*                                   UTILITIES                                  */
/* ========================================================================== */

/**
 * HTTP GET với xoay UA + retry. Ném Error khi tất cả attempt fail.
 * attempts: số lần thử (mặc định 3), mỗi lần dùng 1 UA khác nhau.
 * referer: tuỳ request (vd: https://www.sofascore.com/)
 */
function httpJson_(url, opts) {
  const options = opts || {};
  const attempts = options.attempts || 3;
  const host = hostOf_(url);

  if (isHostBlacklisted_(host)) {
    throw new Error('HOST_BLACKLISTED ' + host + ' @ ' + url);
  }

  let lastErr = null;
  let last403 = false;

  for (let i = 0; i < attempts; i++) {
    const headers = options.referer || options.forceBrowserHeaders
      ? buildBrowserHeaders_(options.referer)
      : { 'User-Agent': pickUA_(), Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' };

    try {
      const res = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
        followRedirects: true,
        headers: headers,
        validateHttpsCertificates: true,
      });
      const code = res.getResponseCode();
      if (code >= 200 && code < 300) {
        return JSON.parse(res.getContentText() || '{}');
      }
      lastErr = new Error('HTTP ' + code + ' @ ' + url);
      last403 = (code === 403 || code === 401 || code === 429);
      // Chỉ retry với 4xx rate-limit / block; 404 / 5xx ném ngay để caller fallback.
      if (!last403 && code !== 502 && code !== 503 && code !== 504) break;
      Utilities.sleep(250 + Math.floor(Math.random() * 400));
    } catch (err) {
      lastErr = err;
      Utilities.sleep(200);
    }
  }

  // Nếu attempt cuối cùng vẫn 403/429 -> blacklist host 5 phút để tiết kiệm quota.
  if (last403 && host) blacklistHost_(host, 300);
  throw lastErr || new Error('HTTP_UNKNOWN @ ' + url);
}

function httpJsonWithoutHeaders_(url) {
  // TheSportsDB đôi khi từ chối UA lạ -> thử không header, sau đó thử xoay UA.
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'get', muteHttpExceptions: true, followRedirects: true,
    });
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) return JSON.parse(res.getContentText() || '{}');
    if (code !== 403 && code !== 429) throw new Error('HTTP ' + code + ' @ ' + url);
  } catch (_) { /* fall through */ }

  // Fallback: dùng httpJson_ (xoay UA + retry).
  return httpJson_(url, { attempts: 2 });
}

/**
 * Gọi SofaScore với auto-fallback qua các mirror (api / www / app).
 * path phải bắt đầu bằng '/' sau '/api/v1' – ví dụ: '/event/12345'.
 * Thứ tự mirror sẽ được nhớ trong cache 2 phút để khỏi thử host đã block.
 */
function sofaFetch_(path) {
  const cache = CacheService.getScriptCache();
  const preferredHost = cache.get('sofa:preferred');
  const mirrors = SOFA_MIRRORS.slice();
  if (preferredHost) {
    mirrors.sort(function (a, b) {
      const ha = hostOf_(a);
      const hb = hostOf_(b);
      if (ha === preferredHost && hb !== preferredHost) return -1;
      if (hb === preferredHost && ha !== preferredHost) return 1;
      return 0;
    });
  }

  let lastErr = null;
  for (let i = 0; i < mirrors.length; i++) {
    const base = mirrors[i];
    const host = hostOf_(base);
    if (isHostBlacklisted_(host)) { lastErr = new Error('blacklisted ' + host); continue; }
    try {
      const data = httpJson_(base + path, { attempts: 2, referer: 'https://www.sofascore.com/' });
      try { cache.put('sofa:preferred', host, 120); } catch (_) { /* noop */ }
      return data;
    } catch (err) {
      lastErr = err;
      Logger.log('sofaFetch_ ' + host + path + ' -> ' + err);
    }
  }
  throw lastErr || new Error('sofaFetch_ all mirrors failed: ' + path);
}

/** Giống httpJson_ nhưng lỗi không ném exception -> null (dùng cho detail để trận thiếu 1 field vẫn trả về phần còn lại). */
function safeJson_(url, opts) {
  try { return httpJson_(url, opts); }
  catch (err) { Logger.log('safeJson fail: ' + url + ' -> ' + err); return null; }
}

/** Phiên bản safeJson_ chuyên cho SofaScore: tự retry đủ mirror. */
function safeSofa_(path) {
  try { return sofaFetch_(path); }
  catch (err) { Logger.log('safeSofa_ fail: ' + path + ' -> ' + err); return null; }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function castValue_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (s === '') return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function stackHint_(err) {
  try {
    if (err && err.stack) return String(err.stack).split('\n').slice(0, 5).join(' | ');
  } catch (_) { /* noop */ }
  return '';
}

function isFinishedStatus_(status) {
  const s = String(status || '').trim().toUpperCase();
  return s === 'FT' || s === 'AET' || s === 'PEN' || s === 'FINISHED';
}

function toNum_(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ========================================================================== */
/*                    DEFAULT LEAGUES (SofaScore config)                       */
/* ========================================================================== */

/**
 * Lấy danh sách giải đấu mặc định theo locale từ SofaScore.
 * endpoint: /config/default-unique-tournaments/{alpha2}/football
 * Trả về: [{ id, name, slug, categoryId, categoryName, country, priority, userCount }]
 */
function fetchDefaultUniqueTournaments_(alpha2) {
  const code = String(alpha2 || 'VN').toUpperCase();
  const path = '/config/default-unique-tournaments/' + encodeURIComponent(code) + '/football';
  const data = safeSofa_(path);
  const list = data && Array.isArray(data.uniqueTournaments) ? data.uniqueTournaments : [];
  return list.map(function (t, idx) {
    const category = t && t.category ? t.category : {};
    return {
      order: idx + 1,
      id: Number(t && t.id),
      name: String((t && t.name) || ''),
      slug: String((t && t.slug) || ''),
      primaryColorHex: String((t && t.primaryColorHex) || ''),
      secondaryColorHex: String((t && t.secondaryColorHex) || ''),
      categoryId: Number(category.id || 0),
      categoryName: String(category.name || ''),
      countryAlpha2: String(category.alpha2 || ''),
      categoryFlag: String(category.flag || ''),
      userCount: Number((t && t.userCount) || 0),
    };
  }).filter(function (t) { return t.id && t.name; });
}

/**
 * Đồng bộ danh sách `featured_leagues` và `featured_tournament_ids` từ SofaScore.
 * - Nếu crawl fail -> giữ nguyên giá trị cũ trong Settings.
 */
function seedFeaturedFromSofa_(alpha2) {
  const items = fetchDefaultUniqueTournaments_(alpha2 || 'VN');
  if (!items.length) {
    return { updated: false, source: 'sofa-failed', count: 0, note: 'Giữ nguyên giá trị hiện tại.' };
  }
  const names = items.map(function (t) { return t.name; }).join('|');
  const ids = items.map(function (t) { return String(t.id); }).join('|');
  writeSettings_({
    featured_leagues: names,
    featured_tournament_ids: ids,
  });
  return {
    updated: true,
    source: 'sofascore',
    count: items.length,
    items: items,
    featured_leagues: names,
    featured_tournament_ids: ids,
  };
}

/* ========================================================================== */
/*                        TOP PLAYERS (vua phá lưới)                           */
/* ========================================================================== */

/**
 * Trả về top player cho 1 giải đấu.
 * Ưu tiên đọc CacheService, rồi sheet TopPlayers (trong TTL), rồi crawl, fallback sheet (stale), fallback [].
 */
function getTopPlayers_(tournamentId, seasonId, category, options) {
  const opts = options || {};
  const tId = String(tournamentId || '').trim();
  if (!tId) return { topPlayers: [], _seasonId: seasonId || '', _source: 'invalid' };

  const cat = normalizeTopCategory_(category);
  const settings = readSettings_();
  const ttlHours = Math.max(1, Number(settings.top_players_ttl_hours) || 12);
  const limit = Math.max(1, Math.min(50, Number(opts.limit) || Number(settings.top_players_limit) || 5));

  let resolvedSeasonId = String(seasonId || '').trim();
  if (!resolvedSeasonId) resolvedSeasonId = resolveSeasonIdForTournament_(tId) || '';

  const cacheKey = 'topp:' + tId + ':' + (resolvedSeasonId || 'cur') + ':' + cat;
  const cache = CacheService.getScriptCache();
  try {
    const cached = cache.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      return {
        topPlayers: (parsed.topPlayers || []).slice(0, limit),
        _seasonId: parsed.seasonId || resolvedSeasonId,
        _source: 'cache',
        _updatedAt: parsed.updatedAt || 0,
      };
    }
  } catch (_) { /* noop */ }

  // Thử đọc sheet trong TTL.
  const fresh = readTopPlayersFromSheet_(tId, resolvedSeasonId, cat);
  if (fresh && isWithinHours_(fresh.updatedAt, ttlHours)) {
    try { cache.put(cacheKey, JSON.stringify(fresh), 60 * 30); } catch (_) { /* noop */ }
    return {
      topPlayers: (fresh.topPlayers || []).slice(0, limit),
      _seasonId: fresh.seasonId || resolvedSeasonId,
      _source: 'sheet-fresh',
      _updatedAt: fresh.updatedAt,
    };
  }

  // Crawl mới.
  try {
    const crawled = crawlTopPlayers_(tId, resolvedSeasonId, cat);
    if (crawled && crawled.topPlayers && crawled.topPlayers.length) {
      writeTopPlayersToSheet_(tId, crawled.seasonId || resolvedSeasonId, cat, {
        topPlayers: crawled.topPlayers,
        seasonId: crawled.seasonId || resolvedSeasonId,
        updatedAt: Date.now(),
      });
      try {
        cache.put(cacheKey, JSON.stringify({
          topPlayers: crawled.topPlayers,
          seasonId: crawled.seasonId || resolvedSeasonId,
          updatedAt: Date.now(),
        }), 60 * 30);
      } catch (_) { /* noop */ }
      return {
        topPlayers: crawled.topPlayers.slice(0, limit),
        _seasonId: crawled.seasonId || resolvedSeasonId,
        _source: 'sofa',
        _updatedAt: Date.now(),
      };
    }
  } catch (err) {
    Logger.log('getTopPlayers_ crawl fail ' + tId + '/' + cat + ' -> ' + err);
  }

  // Fallback stale.
  if (fresh) {
    return {
      topPlayers: (fresh.topPlayers || []).slice(0, limit),
      _seasonId: fresh.seasonId || resolvedSeasonId,
      _source: 'sheet-stale',
      _updatedAt: fresh.updatedAt,
    };
  }

  return { topPlayers: [], _seasonId: resolvedSeasonId, _source: 'empty' };
}

/** Crawl fresh top players từ SofaScore. Không đụng cache. */
function crawlTopPlayers_(tournamentId, seasonId, category) {
  const tId = String(tournamentId || '').trim();
  if (!tId) return { topPlayers: [], seasonId: '' };

  let sId = String(seasonId || '').trim();
  if (!sId) sId = resolveSeasonIdForTournament_(tId) || '';
  if (!sId) return { topPlayers: [], seasonId: '' };

  const cat = normalizeTopCategory_(category);
  const path = '/unique-tournament/' + encodeURIComponent(tId)
    + '/season/' + encodeURIComponent(sId)
    + '/top-players/overall';
  const data = safeSofa_(path);
  if (!data || !data.topPlayers) return { topPlayers: [], seasonId: sId };

  const arr = Array.isArray(data.topPlayers[cat]) ? data.topPlayers[cat] : [];
  const players = arr.map(function (row) {
    const p = (row && row.player) || {};
    const team = (row && row.team) || {};
    const stats = (row && row.statistics) || {};
    return {
      playerId: Number(p.id || 0),
      name: String(p.name || p.shortName || ''),
      shortName: String(p.shortName || p.name || ''),
      position: String(p.position || ''),
      jerseyNumber: String(p.jerseyNumber || ''),
      playerLogo: p.id ? ('https://img.sofascore.com/api/v1/player/' + p.id + '/image') : '',
      teamId: Number(team.id || 0),
      teamName: String(team.name || ''),
      teamShortName: String(team.shortName || team.name || ''),
      teamLogo: team.id ? ('https://img.sofascore.com/api/v1/team/' + team.id + '/image') : '',
      goals: Number(stats.goals || 0),
      assists: Number(stats.assists || 0),
      appearances: Number(stats.appearances || 0),
      minutesPlayed: Number(stats.minutesPlayed || 0),
      rating: Number(stats.rating || 0),
      yellowCards: Number(stats.yellowCards || 0),
      redCards: Number(stats.redCards || 0),
      expectedGoals: Number(stats.expectedGoals || 0),
      expectedAssists: Number(stats.expectedAssists || 0),
    };
  }).filter(function (p) { return p.playerId && p.name; });

  return { topPlayers: players, seasonId: sId };
}

/** Crawl nhiều category (goals, assists, rating) cho 1 giải - gọi từ Admin. */
function crawlTopPlayersMulti_(tournamentId, seasonId, categories, options) {
  const opts = options || {};
  const cats = (Array.isArray(categories) && categories.length) ? categories : ['goals', 'assists', 'rating'];
  const report = { tournamentId: String(tournamentId || ''), seasonId: '', results: [] };

  let sId = String(seasonId || '').trim();
  if (!sId) sId = resolveSeasonIdForTournament_(tournamentId) || '';
  report.seasonId = sId;

  cats.forEach(function (rawCat) {
    const cat = normalizeTopCategory_(rawCat);
    const key = String(tournamentId) + ':' + sId + ':' + cat;
    if (!opts.forceRefresh) {
      const existing = readTopPlayersFromSheet_(tournamentId, sId, cat);
      if (existing && isWithinHours_(existing.updatedAt, 6)) {
        report.results.push({ key: key, category: cat, source: 'sheet-cache', count: (existing.topPlayers || []).length });
        return;
      }
    }
    try {
      const data = crawlTopPlayers_(tournamentId, sId, cat);
      if (data.topPlayers && data.topPlayers.length) {
        writeTopPlayersToSheet_(tournamentId, data.seasonId || sId, cat, {
          topPlayers: data.topPlayers,
          seasonId: data.seasonId || sId,
          updatedAt: Date.now(),
        });
        report.results.push({ key: key, category: cat, source: 'sofa', count: data.topPlayers.length });
      } else {
        report.results.push({ key: key, category: cat, source: 'empty', count: 0 });
      }
    } catch (err) {
      report.results.push({ key: key, category: cat, source: 'error', error: String(err) });
    }
  });

  return report;
}

function normalizeTopCategory_(cat) {
  const c = String(cat || '').trim().toLowerCase();
  if (c === 'goal' || c === 'goals' || c === 'scorer' || c === 'scorers' || c === 'topscorer') return 'goals';
  if (c === 'assist' || c === 'assists' || c === 'assistants') return 'assists';
  if (c === 'rating' || c === 'ratings' || c === 'best') return 'rating';
  if (c === 'goalsassistssum' || c === 'ga' || c === 'sum') return 'goalsAssistsSum';
  return c || 'goals';
}

/** Tìm seasonId hiện tại cho 1 tournament - ưu tiên đọc từ LiveScore, fallback gọi Sofa. */
function resolveSeasonIdForTournament_(tournamentId) {
  const tId = String(tournamentId || '').trim();
  if (!tId) return '';
  try {
    const live = readLiveScore_() || [];
    for (let i = 0; i < live.length; i++) {
      const m = live[i];
      if (String(m.tournamentId || '') === tId && m.seasonId) return String(m.seasonId);
    }
  } catch (_) { /* noop */ }

  try {
    const data = safeSofa_('/unique-tournament/' + encodeURIComponent(tId) + '/seasons');
    const list = data && Array.isArray(data.seasons) ? data.seasons : [];
    if (list.length) return String(list[0].id || '');
  } catch (_) { /* noop */ }

  return '';
}

function isWithinHours_(ts, hours) {
  const n = Number(ts || 0);
  if (!n) return false;
  return (Date.now() - n) < hours * 3600 * 1000;
}

function readTopPlayersFromSheet_(tournamentId, seasonId, category) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_TOPPLAYERS);
  if (!sh) return null;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  const key = String(tournamentId) + ':' + String(seasonId || '') + ':' + normalizeTopCategory_(category);
  const rows = sh.getRange(2, 1, lastRow - 1, 5).getValues();
  for (let i = 0; i < rows.length; i++) {
    const rowKey = String(rows[i][0] || '').trim();
    if (rowKey !== key) continue;
    const updatedAt = Number(new Date(rows[i][3]).getTime()) || 0;
    let payload = null;
    try { payload = JSON.parse(rows[i][4] || '{}'); } catch (_) { payload = {}; }
    return {
      key: key,
      updatedAt: updatedAt,
      topPlayers: Array.isArray(payload.topPlayers) ? payload.topPlayers : [],
      seasonId: String(payload.seasonId || seasonId || ''),
    };
  }
  return null;
}

function writeTopPlayersToSheet_(tournamentId, seasonId, category, payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_TOPPLAYERS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TOPPLAYERS);
    sh.getRange(1, 1, 1, 5)
      .setValues([['key', 'tournamentId', 'category', 'updatedAt', 'payload']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  const cat = normalizeTopCategory_(category);
  const key = String(tournamentId) + ':' + String(seasonId || '') + ':' + cat;
  const body = JSON.stringify({
    topPlayers: Array.isArray(payload.topPlayers) ? payload.topPlayers : [],
    seasonId: String(payload.seasonId || seasonId || ''),
  });
  const now = new Date();

  sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
  sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat('@');
  sh.getRange(1, 3, sh.getMaxRows(), 1).setNumberFormat('@');

  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    const keysCol = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keysCol.length; i++) {
      if (String(keysCol[i][0] || '').trim() === key) {
        sh.getRange(i + 2, 1, 1, 5).setValues([[key, String(tournamentId), cat, now, body]]);
        return;
      }
    }
  }
  sh.appendRow([key, String(tournamentId), cat, now, body]);
}

/* ========================================================================== */
/*                            TOURNAMENT INFO                                  */
/* ========================================================================== */

/**
 * Crawl fresh thông tin 1 giải đấu từ SofaScore (không đụng cache).
 * endpoint: /unique-tournament/{id}
 * Trả về object chuẩn hoá: { id, name, slug, category, country, logo, primaryColorHex,
 *                            currentSeasonId, currentSeasonName, totalRounds, titleHolderTeamId, titleHolderTeamName }
 */
function crawlTournamentInfoFresh_(tournamentId) {
  const tId = String(tournamentId || '').trim();
  if (!tId) return null;

  const data = safeSofa_('/unique-tournament/' + encodeURIComponent(tId));
  const ut = data && data.uniqueTournament ? data.uniqueTournament : null;
  if (!ut) return null;

  const category = ut.category || {};
  const currentSeason = ut.currentSeason || {};
  const titleHolder = ut.titleHolder || {};

  return {
    id: Number(ut.id || tId),
    name: String(ut.name || ''),
    slug: String(ut.slug || ''),
    primaryColorHex: String(ut.primaryColorHex || ''),
    secondaryColorHex: String(ut.secondaryColorHex || ''),
    userCount: Number(ut.userCount || 0),
    hasRounds: !!ut.hasRounds,
    hasGroups: !!ut.hasGroups,
    hasStandingsGroups: !!ut.hasStandingsGroups,
    hasPlayoffSeries: !!ut.hasPlayoffSeries,
    category: {
      id: Number(category.id || 0),
      name: String(category.name || ''),
      slug: String(category.slug || ''),
      flag: String(category.flag || ''),
      alpha2: String(category.alpha2 || ''),
    },
    country: String(category.name || ''),
    logo: 'https://img.sofascore.com/api/v1/unique-tournament/' + ut.id + '/image',
    logoDark: 'https://img.sofascore.com/api/v1/unique-tournament/' + ut.id + '/image/dark',
    currentSeasonId: String(currentSeason.id || ''),
    currentSeasonName: String(currentSeason.name || ''),
    currentSeasonYear: String(currentSeason.year || ''),
    mostTitles: Number(ut.mostTitles || 0),
    mostTitlesTeams: Array.isArray(ut.mostTitlesTeams)
      ? ut.mostTitlesTeams.map(function (t) { return { id: Number(t.id || 0), name: String(t.name || '') }; })
      : [],
    titleHolderTeamId: Number(titleHolder.id || 0),
    titleHolderTeamName: String(titleHolder.name || ''),
    titleHolderTitles: Number(ut.titleHolderTitles || 0),
    linkedUniqueTournaments: Array.isArray(ut.linkedUniqueTournaments)
      ? ut.linkedUniqueTournaments.map(function (x) { return { id: Number(x.id || 0), name: String(x.name || '') }; })
      : [],
  };
}

/** Đọc từ sheet TournamentInfo theo tournamentId. */
function readTournamentInfoFromSheet_(tournamentId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_TOURNAMENTS);
  if (!sh) return null;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const tId = String(tournamentId || '').trim();
  const rows = sh.getRange(2, 1, lastRow - 1, 5).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() !== tId) continue;
    const updatedAt = Number(new Date(rows[i][3]).getTime()) || 0;
    let payload = null;
    try { payload = JSON.parse(rows[i][4] || '{}'); } catch (_) { payload = {}; }
    return { updatedAt: updatedAt, payload: payload };
  }
  return null;
}

function writeTournamentInfoToSheet_(info) {
  if (!info || !info.id) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_TOURNAMENTS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TOURNAMENTS);
    sh.getRange(1, 1, 1, 5)
      .setValues([['tournamentId', 'slug', 'name', 'updatedAt', 'payload']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  const tId = String(info.id);
  const now = new Date();
  const body = JSON.stringify(info);

  sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
  sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat('@');

  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || '').trim() === tId) {
        sh.getRange(i + 2, 1, 1, 5).setValues([[tId, String(info.slug || ''), String(info.name || ''), now, body]]);
        return;
      }
    }
  }
  sh.appendRow([tId, String(info.slug || ''), String(info.name || ''), now, body]);
}

/** getTournamentInfo_ có cache chain: CacheService 6h -> sheet (TTL) -> crawl -> sheet stale -> null. */
function getTournamentInfo_(tournamentId) {
  const tId = String(tournamentId || '').trim();
  if (!tId) return null;

  const settings = readSettings_();
  const ttlDays = Math.max(1, Number(settings.tournament_info_ttl_days) || 7);
  const cacheKey = 'tinfo:' + tId;
  const cache = CacheService.getScriptCache();
  try {
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (_) { /* noop */ }

  const existing = readTournamentInfoFromSheet_(tId);
  if (existing && existing.payload && isWithinHours_(existing.updatedAt, ttlDays * 24)) {
    try { cache.put(cacheKey, JSON.stringify(existing.payload), 60 * 60 * 6); } catch (_) { /* noop */ }
    return existing.payload;
  }

  try {
    const fresh = crawlTournamentInfoFresh_(tId);
    if (fresh && fresh.name) {
      writeTournamentInfoToSheet_(fresh);
      try { cache.put(cacheKey, JSON.stringify(fresh), 60 * 60 * 6); } catch (_) { /* noop */ }
      return fresh;
    }
  } catch (err) {
    Logger.log('getTournamentInfo_ crawl fail ' + tId + ' -> ' + err);
  }

  return existing ? existing.payload : null;
}

/* ========================================================================== */
/*                       BATCH CRAWL TOP N LEAGUES                             */
/* ========================================================================== */

/**
 * Trả về danh sách tournamentId ưu tiên theo thứ tự, đọc từ Settings.
 * - Ưu tiên `featured_tournament_ids` (ID chính xác).
 * - Nếu thiếu -> fallback: crawl SofaScore default-unique-tournaments/VN.
 * - n: số phần tử cần lấy; nếu không truyền -> dùng top_leagues_n (mặc định 8).
 */
function resolveTopLeagueIds_(n) {
  const settings = readSettings_();
  let list = String(settings.featured_tournament_ids || '')
    .split('|')
    .map(function (s) { return String(s).trim(); })
    .filter(function (s) { return s && /^\d+$/.test(s); });

  if (!list.length) {
    try {
      const items = fetchDefaultUniqueTournaments_('VN');
      list = items.map(function (x) { return String(x.id); });
    } catch (err) { /* noop */ }
  }

  const count = Math.max(1, Math.min(50, Number(n) || Number(settings.top_leagues_n) || 8));
  return list.slice(0, count);
}

/** Crawl tournament info cho N giải hàng đầu. */
function crawlTournamentInfoTopLeagues_(n, options) {
  const opts = options || {};
  const ids = resolveTopLeagueIds_(n);
  const settings = readSettings_();
  const ttlDays = Math.max(1, Number(settings.tournament_info_ttl_days) || 7);
  const results = [];

  ids.forEach(function (tId) {
    if (!opts.forceRefresh) {
      const existing = readTournamentInfoFromSheet_(tId);
      if (existing && existing.payload && isWithinHours_(existing.updatedAt, ttlDays * 24)) {
        results.push({ tournamentId: tId, name: existing.payload.name || '', source: 'sheet-cache' });
        return;
      }
    }
    try {
      const info = crawlTournamentInfoFresh_(tId);
      if (info && info.name) {
        writeTournamentInfoToSheet_(info);
        results.push({ tournamentId: tId, name: info.name, source: 'sofa', seasonId: info.currentSeasonId });
      } else {
        results.push({ tournamentId: tId, source: 'empty' });
      }
    } catch (err) {
      results.push({ tournamentId: tId, source: 'error', error: String(err) });
    }
  });

  return { count: ids.length, results: results };
}

/** Crawl đội bóng cho N giải hàng đầu (tái sử dụng crawlTeamsByLeague_). */
function crawlTeamsTopLeagues_(n, options) {
  const opts = options || {};
  const ids = resolveTopLeagueIds_(n);
  const settings = readSettings_();
  const defaultLimit = Math.max(1, Number(opts.teamLimit) || Number(settings.league_crawl_default_limit) || 30);
  const results = [];

  ids.forEach(function (tId) {
    try {
      // Cần currentSeasonId -> lấy từ TournamentInfo (crawl nếu thiếu).
      let info = getTournamentInfo_(tId);
      if (!info) info = { currentSeasonId: '' };
      const seasonId = String(info.currentSeasonId || resolveSeasonIdForTournament_(tId) || '');

      const r = crawlTeamsByLeague_(String(tId), seasonId, {
        limit: defaultLimit,
        forceRefresh: !!opts.forceRefresh,
      });
      results.push({
        tournamentId: tId,
        name: info.name || '',
        seasonId: seasonId,
        success: r.success || 0,
        skipped: r.skipped || 0,
        failed: r.failed || 0,
      });
    } catch (err) {
      results.push({ tournamentId: tId, error: String(err) });
    }
  });

  return { count: ids.length, results: results };
}

/** Crawl top players cho N giải hàng đầu. */
function crawlTopPlayersTopLeagues_(n, options) {
  const opts = options || {};
  const ids = resolveTopLeagueIds_(n);
  const cats = Array.isArray(opts.categories) && opts.categories.length
    ? opts.categories
    : ['goals', 'assists', 'rating'];
  const results = [];

  ids.forEach(function (tId) {
    try {
      let info = getTournamentInfo_(tId);
      if (!info) info = { currentSeasonId: '' };
      const seasonId = String(info.currentSeasonId || resolveSeasonIdForTournament_(tId) || '');
      const r = crawlTopPlayersMulti_(String(tId), seasonId, cats, { forceRefresh: !!opts.forceRefresh });
      const ok = (r.results || []).filter(function (x) { return x.source === 'sofa'; }).length;
      const cached = (r.results || []).filter(function (x) { return x.source === 'sheet-cache'; }).length;
      const err = (r.results || []).filter(function (x) { return x.source === 'error' || x.source === 'empty'; }).length;
      results.push({
        tournamentId: tId,
        name: info.name || '',
        seasonId: seasonId,
        categoriesOk: ok,
        categoriesCached: cached,
        categoriesFailed: err,
      });
    } catch (err) {
      results.push({ tournamentId: tId, error: String(err) });
    }
  });

  return { count: ids.length, categories: cats, results: results };
}

/** Crawl tất cả: info + teams + top players cho N giải. */
function crawlAllTopLeagues_(n, options) {
  const opts = options || {};
  const info = crawlTournamentInfoTopLeagues_(n, { forceRefresh: !!opts.forceRefresh });
  const teams = crawlTeamsTopLeagues_(n, { teamLimit: opts.teamLimit, forceRefresh: !!opts.forceRefresh });
  const topPlayers = crawlTopPlayersTopLeagues_(n, {
    categories: opts.categories || ['goals', 'assists'],
    forceRefresh: !!opts.forceRefresh,
  });
  return {
    n: n,
    info: info,
    teams: teams,
    topPlayers: topPlayers,
  };
}
