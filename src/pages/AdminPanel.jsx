import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useConfig } from '../hooks/useConfig.jsx';
import {
  apiUpdateSettings,
  apiRefreshSports,
  apiSetupSettingsOnly,
  apiResetBlacklist,
  apiNormalizeSheets,
  apiCrawlTeamsByLeague,
  apiCrawlTeamsByIds,
  apiSeedFeaturedFromSofa,
  apiCrawlTopPlayers,
  apiCrawlTopLeaguesInfo,
  apiCrawlTopLeaguesTeams,
  apiCrawlTopLeaguesTopPlayers,
  apiCrawlTopLeaguesAll,
} from '../config/api.js';
import { clearStoredToken, getStoredToken } from './AdminLogin.jsx';

/**
 * Nhận diện kiểu input dựa vào key + giá trị hiện tại.
 * - boolean -> toggle
 * - color (key chứa 'color') -> color picker
 * - number -> number input
 * - long text (meta_description, announcement) -> textarea
 * - còn lại -> text
 */
function detectType(key, value) {
  if (typeof value === 'boolean') return 'boolean';
  if (/color/i.test(key)) return 'color';
  if (typeof value === 'number' || /_ms$|_id$|_slot_/.test(key)) return 'number';
  if (/description|announcement|keywords/i.test(key)) return 'textarea';
  if (/token|api_key|secret/i.test(key)) return 'password';
  return 'text';
}

function Field({ fieldKey, value, onChange }) {
  const type = detectType(fieldKey, value);

  if (type === 'boolean') {
    return (
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
          value ? 'bg-cyan-400' : 'bg-slate-600'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    );
  }

  if (type === 'color') {
    return (
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={String(value || '#22d3ee')}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 cursor-pointer rounded-lg border border-white/10 bg-slate-900/60"
        />
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="input"
        />
      </div>
    );
  }

  if (type === 'textarea') {
    return (
      <textarea
        rows={3}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="input resize-y"
      />
    );
  }

  if (type === 'password') {
    return (
      <input
        type="password"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="input"
        autoComplete="new-password"
      />
    );
  }

  if (type === 'number') {
    return (
      <input
        type="text"
        inputMode="numeric"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      />
    );
  }

  return (
    <input
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      className="input"
    />
  );
}

/** Group các key theo tiền tố cho dễ nhìn. */
function groupKey(key) {
  if (key.startsWith('meta_')) return 'SEO / Meta';
  if (key.startsWith('ads_') || key === 'adsense_client') return 'Quảng cáo';
  if (/color|site_|tagline|announcement/.test(key)) return 'Giao diện & Thương hiệu';
  if (/api_key|token|secret/.test(key)) return 'Bảo mật';
  return 'Hệ thống';
}

export default function AdminPanel() {
  const { settings, liveScore, reload, loading, error } = useConfig();
  const [form, setForm] = useState({});
  const [dirty, setDirty] = useState({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ type: null, text: '' });
  const nav = useNavigate();
  const token = getStoredToken();

  useEffect(() => {
    if (!token) nav('/secret-admin', { replace: true });
  }, [token, nav]);

  useEffect(() => {
    if (!loading) setForm(settings || {});
  }, [settings, loading]);

  const grouped = useMemo(() => {
    const entries = Object.keys(form || {}).sort();
    const out = {};
    entries.forEach((k) => {
      const g = groupKey(k);
      (out[g] = out[g] || []).push(k);
    });
    return out;
  }, [form]);

  const hasDirty = Object.keys(dirty).length > 0;
  const availableLeagues = useMemo(() => {
    const map = {};
    (liveScore || []).forEach((m) => {
      const name = String(m.league || '').trim();
      if (!name) return;
      if (!map[name]) map[name] = { name, count: 0, logo: m.leagueLogo || '' };
      map[name].count += 1;
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [liveScore]);

  function update(k, v) {
    setForm((s) => ({ ...s, [k]: v }));
    setDirty((d) => ({ ...d, [k]: true }));
  }

  async function handleSave() {
    setSaving(true);
    setStatus({ type: null, text: '' });
    try {
      const payload = {};
      Object.keys(dirty).forEach((k) => {
        payload[k] = form[k];
      });
      const res = await apiUpdateSettings(token, payload);
      setDirty({});
      setStatus({
        type: 'ok',
        text: `Đã lưu ${res.updated ?? Object.keys(payload).length} mục.${
          res.demo ? ' (chế độ demo, chưa cấu hình GAS)' : ''
        }`,
      });
      reload();
    } catch (err) {
      setStatus({ type: 'err', text: String(err.message || err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshSports() {
    try {
      await apiRefreshSports(token);
      setStatus({ type: 'ok', text: 'Đã kích hoạt cập nhật Sports Data.' });
      reload();
    } catch (err) {
      setStatus({ type: 'err', text: String(err.message || err) });
    }
  }

  async function handleSetupSettingsOnly() {
    try {
      const res = await apiSetupSettingsOnly(token);
      setStatus({
        type: 'ok',
        text: `Đã setup Settings an toàn. Thêm mới ${res.appended ?? 0} key.`,
      });
      reload();
    } catch (err) {
      setStatus({ type: 'err', text: String(err.message || err) });
    }
  }

  async function handleResetBlacklist() {
    try {
      const res = await apiResetBlacklist(token);
      setStatus({
        type: 'ok',
        text: `Đã xoá blacklist cho ${(res.removed || []).length} host. Crawler có thể thử lại ngay.`,
      });
    } catch (err) {
      setStatus({ type: 'err', text: String(err.message || err) });
    }
  }

  async function handleNormalizeSheets() {
    try {
      const res = await apiNormalizeSheets(token);
      const t = res.teamDaily || {};
      const m = res.matchDetails || {};
      const s = res.standings || {};
      setStatus({
        type: 'ok',
        text: `Đã chuẩn hoá sheet: TeamDaily -${t.removed || 0} / MatchDetails -${m.removed || 0} / Standings -${s.removed || 0}.`,
      });
    } catch (err) {
      setStatus({ type: 'err', text: String(err.message || err) });
    }
  }

  async function handleSeedFeaturedFromSofa() {
    try {
      const res = await apiSeedFeaturedFromSofa(token, 'VN');
      if (!res.updated) {
        setStatus({ type: 'err', text: `Không đồng bộ được danh sách giải: ${res.note || 'SofaScore không phản hồi.'}` });
        return;
      }
      setStatus({
        type: 'ok',
        text: `Đã đồng bộ ${res.count} giải đấu mặc định từ SofaScore (VN) → featured_leagues.`,
      });
      reload();
    } catch (err) {
      setStatus({ type: 'err', text: String(err.message || err) });
    }
  }

  function handleLogout() {
    clearStoredToken();
    nav('/secret-admin', { replace: true });
  }

  function handleAddKey() {
    const key = prompt('Nhập key mới (snake_case):');
    if (!key) return;
    const k = key.trim();
    if (!k || form[k] !== undefined) return;
    update(k, '');
  }

  return (
    <div className="space-y-6">
      <motion.header
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-strong flex flex-col items-start justify-between gap-3 p-5 md:flex-row md:items-center"
      >
        <div>
          <div className="text-xs uppercase tracking-widest text-rose-300">Secret Admin</div>
          <h1 className="text-2xl font-bold">Mega Hub · Control Panel</h1>
          <p className="text-xs text-slate-400">
            Chỉnh sửa dưới đây sẽ được đồng bộ ngược lên Google Sheets qua POST.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleAddKey} className="btn-ghost text-xs">+ Thêm key</button>
          <button onClick={handleSetupSettingsOnly} className="btn-ghost text-xs">⚙ Setup Settings</button>
          <button onClick={handleRefreshSports} className="btn-ghost text-xs">↻ Refresh Sports</button>
          <button onClick={handleResetBlacklist} className="btn-ghost text-xs">🧹 Reset Block 403</button>
          <button onClick={handleNormalizeSheets} className="btn-ghost text-xs">🧽 Chuẩn hoá dữ liệu</button>
          <button onClick={handleSeedFeaturedFromSofa} className="btn-ghost text-xs">🏆 Giải mặc định (VN)</button>
          <button onClick={reload} className="btn-ghost text-xs">↻ Tải lại</button>
          <button onClick={handleLogout} className="btn-ghost text-xs">Đăng xuất</button>
          <button
            onClick={handleSave}
            disabled={!hasDirty || saving}
            className="btn-primary text-xs"
          >
            {saving ? 'Đang lưu…' : `Lưu (${Object.keys(dirty).length})`}
          </button>
        </div>
      </motion.header>

      {status.text && (
        <div
          className={`rounded-xl border px-4 py-2 text-sm ${
            status.type === 'ok'
              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
              : 'border-red-400/40 bg-red-400/10 text-red-200'
          }`}
        >
          {status.text}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-2 text-sm text-red-200">
          Lỗi tải cấu hình: {error}
        </div>
      )}

      <TeamCrawlerPanel
        token={token}
        liveScore={liveScore}
        onStatus={(type, text) => setStatus({ type, text })}
      />

      <TopPlayersCrawlerPanel
        token={token}
        liveScore={liveScore}
        onStatus={(type, text) => setStatus({ type, text })}
      />

      <TopLeaguesBatchPanel
        token={token}
        defaultN={Number(settings?.top_leagues_n) || 8}
        onStatus={(type, text) => setStatus({ type, text })}
      />

      {Object.entries(grouped).map(([group, keys]) => (
        <section key={group} className="glass p-5">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-cyan-300">
            {group}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {keys.map((k) => (
              <div key={k} className={`rounded-xl p-3 ${dirty[k] ? 'ring-1 ring-cyan-400/40 bg-cyan-400/5' : ''}`}>
                <label className="label flex items-center justify-between">
                  <span className="font-mono text-[11px] text-slate-300">{k}</span>
                  {dirty[k] && <span className="text-[10px] text-cyan-300">đã sửa</span>}
                </label>
                {k === 'featured_leagues' ? (
                  <FeaturedLeagueEditor
                    value={form[k]}
                    onChange={(v) => update(k, v)}
                    availableLeagues={availableLeagues}
                  />
                ) : (
                  <Field fieldKey={k} value={form[k]} onChange={(v) => update(k, v)} />
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {Object.keys(form).length === 0 && !loading && (
        <div className="glass p-10 text-center text-slate-400">
          Chưa có setting nào. Thêm key đầu tiên để bắt đầu.
        </div>
      )}
    </div>
  );
}

function FeaturedLeagueEditor({ value, onChange, availableLeagues }) {
  const selected = useMemo(
    () =>
      String(value || '')
        .split('|')
        .map((x) => x.trim())
        .filter(Boolean),
    [value]
  );

  const selectedSet = useMemo(() => {
    const out = {};
    selected.forEach((x) => {
      out[x.toLowerCase()] = true;
    });
    return out;
  }, [selected]);

  function apply(next) {
    onChange(next.join('|'));
  }

  function toggle(leagueName) {
    if (!leagueName) return;
    const exists = selected.some((x) => x.toLowerCase() === leagueName.toLowerCase());
    const next = exists
      ? selected.filter((x) => x.toLowerCase() !== leagueName.toLowerCase())
      : [...selected, leagueName];
    apply(next);
  }

  function move(idx, dir) {
    const to = idx + dir;
    if (to < 0 || to >= selected.length) return;
    const next = [...selected];
    const tmp = next[idx];
    next[idx] = next[to];
    next[to] = tmp;
    apply(next);
  }

  function clearAll() {
    apply([]);
  }

  return (
    <div className="space-y-3">
      <textarea
        rows={3}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="input resize-y"
      />

      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
        <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
          <span>Thứ tự giải đang chọn ({selected.length})</span>
          <button type="button" className="text-xs text-rose-300 hover:text-rose-200" onClick={clearAll}>
            Xóa hết
          </button>
        </div>
        {selected.length === 0 ? (
          <div className="text-xs text-slate-500">Chưa có giải nào. Chọn từ danh sách bên dưới.</div>
        ) : (
          <div className="space-y-1">
            {selected.map((name, idx) => (
              <div key={`${name}-${idx}`} className="flex items-center gap-2 rounded bg-slate-900/50 px-2 py-1.5 text-xs">
                <span className="w-5 text-center font-mono text-slate-400">{idx + 1}</span>
                <span className="flex-1 truncate">{name}</span>
                <button type="button" className="rounded bg-white/10 px-1.5 py-0.5" onClick={() => move(idx, -1)}>↑</button>
                <button type="button" className="rounded bg-white/10 px-1.5 py-0.5" onClick={() => move(idx, 1)}>↓</button>
                <button type="button" className="rounded bg-rose-500/20 px-1.5 py-0.5 text-rose-300" onClick={() => toggle(name)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
        <div className="mb-2 text-[11px] uppercase tracking-wider text-slate-400">
          Danh sách giải hiện có (bấm để thêm/bỏ)
        </div>
        <div className="flex max-h-44 flex-wrap gap-2 overflow-auto pr-1 scrollbar-thin">
          {(availableLeagues || []).map((l) => {
            const active = !!selectedSet[l.name.toLowerCase()];
            return (
              <button
                key={l.name}
                type="button"
                onClick={() => toggle(l.name)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition ${
                  active
                    ? 'bg-cyan-400/20 text-cyan-200 ring-1 ring-cyan-400/40'
                    : 'bg-slate-900/50 text-slate-300 hover:bg-slate-800'
                }`}
                title={`${l.name} (${l.count} trận)`}
              >
                {l.logo ? <img src={l.logo} alt="" className="h-4 w-4 rounded-full bg-slate-800 object-contain" /> : null}
                <span>{l.name}</span>
                <span className="text-[10px] opacity-70">({l.count})</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TeamCrawlerPanel({ token, liveScore, onStatus }) {
  const leagues = useMemo(() => {
    const map = {};
    (liveScore || []).forEach((m) => {
      const key = String(m.tournamentId || '') + ':' + String(m.seasonId || '');
      if (!m.tournamentId) return;
      if (!map[key]) {
        map[key] = {
          tournamentId: String(m.tournamentId),
          seasonId: String(m.seasonId || ''),
          name: m.league || 'Không rõ giải',
          logo: m.leagueLogo || '',
          teams: {},
        };
      }
      if (m.homeId) map[key].teams[String(m.homeId)] = m.home || '';
      if (m.awayId) map[key].teams[String(m.awayId)] = m.away || '';
    });
    return Object.values(map)
      .map((l) => ({ ...l, teamList: Object.keys(l.teams).map((id) => ({ teamId: id, teamName: l.teams[id] })) }))
      .sort((a, b) => b.teamList.length - a.teamList.length);
  }, [liveScore]);

  const [selectedLeagueKey, setSelectedLeagueKey] = useState('');
  const [limit, setLimit] = useState(30);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [checkedTeams, setCheckedTeams] = useState({});
  const [working, setWorking] = useState(false);

  const selectedLeague = useMemo(() => {
    if (!selectedLeagueKey) return null;
    return leagues.find((l) => `${l.tournamentId}:${l.seasonId}` === selectedLeagueKey) || null;
  }, [leagues, selectedLeagueKey]);

  function toggleTeam(id) {
    setCheckedTeams((s) => ({ ...s, [id]: !s[id] }));
  }

  function toggleAllVisible(on) {
    if (!selectedLeague) return;
    const next = { ...checkedTeams };
    selectedLeague.teamList.forEach((t) => {
      next[t.teamId] = !!on;
    });
    setCheckedTeams(next);
  }

  async function handleCrawlLeague() {
    if (!selectedLeague) return;
    setWorking(true);
    try {
      const res = await apiCrawlTeamsByLeague(token, {
        tournamentId: selectedLeague.tournamentId,
        seasonId: selectedLeague.seasonId,
        limit,
        forceRefresh,
      });
      onStatus(
        'ok',
        `Crawl "${selectedLeague.name}": ${res.success || 0} thành công, ${res.skipped || 0} còn hạn TTL, ${res.failed || 0} lỗi.`
      );
    } catch (err) {
      onStatus('err', String(err.message || err));
    } finally {
      setWorking(false);
    }
  }

  async function handleCrawlSelected() {
    const ids = Object.keys(checkedTeams).filter((k) => checkedTeams[k]);
    if (!ids.length) {
      onStatus('err', 'Chọn ít nhất 1 CLB để crawl.');
      return;
    }
    const teamMap = {};
    leagues.forEach((l) => {
      l.teamList.forEach((t) => {
        teamMap[t.teamId] = { teamName: t.teamName, tournamentId: l.tournamentId, seasonId: l.seasonId };
      });
    });
    const items = ids.map((id) => ({
      teamId: id,
      teamName: teamMap[id]?.teamName || '',
      tournamentId: teamMap[id]?.tournamentId || '',
      seasonId: teamMap[id]?.seasonId || '',
    }));

    setWorking(true);
    try {
      const res = await apiCrawlTeamsByIds(token, { items, forceRefresh });
      onStatus(
        'ok',
        `Crawl ${ids.length} CLB: ${res.success || 0} thành công, ${res.skipped || 0} còn hạn TTL, ${res.failed || 0} lỗi.`
      );
    } catch (err) {
      onStatus('err', String(err.message || err));
    } finally {
      setWorking(false);
    }
  }

  const selectedCount = Object.values(checkedTeams).filter(Boolean).length;

  return (
    <section className="glass p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-300">Crawl đội bóng</h2>
          <p className="text-[11px] text-slate-400">
            Chia theo giải đấu hoặc CLB. Dữ liệu còn trong TTL (team_cache_ttl_days) sẽ được bỏ qua,
            trừ khi bật "Force refresh".
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={forceRefresh}
            onChange={(e) => setForceRefresh(e.target.checked)}
            className="h-4 w-4 rounded border-slate-500 bg-slate-900"
          />
          Force refresh (bỏ qua TTL)
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
            Theo giải đấu
          </div>
          <div className="space-y-3">
            <select
              value={selectedLeagueKey}
              onChange={(e) => {
                setSelectedLeagueKey(e.target.value);
                setCheckedTeams({});
              }}
              className="input"
            >
              <option value="">— Chọn giải đấu —</option>
              {leagues.map((l) => (
                <option key={`${l.tournamentId}:${l.seasonId}`} value={`${l.tournamentId}:${l.seasonId}`}>
                  {l.name} ({l.teamList.length} CLB)
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span>Giới hạn:</span>
              <input
                type="number"
                min={1}
                max={200}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 30)}
                className="input w-24"
              />
              <span className="opacity-70">đội / lần</span>
            </div>
            <button
              type="button"
              onClick={handleCrawlLeague}
              disabled={!selectedLeague || working}
              className="btn-primary text-xs"
            >
              {working ? 'Đang crawl…' : selectedLeague ? `↻ Crawl giải "${selectedLeague.name}"` : 'Chọn giải để crawl'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-300">
            <span>Theo CLB ({selectedCount} đã chọn)</span>
            {selectedLeague && (
              <div className="flex gap-1 text-[10px]">
                <button type="button" onClick={() => toggleAllVisible(true)} className="btn-ghost px-2 py-0.5">Chọn hết</button>
                <button type="button" onClick={() => toggleAllVisible(false)} className="btn-ghost px-2 py-0.5">Bỏ chọn</button>
              </div>
            )}
          </div>
          <div className="max-h-48 space-y-1 overflow-auto pr-1 scrollbar-thin">
            {selectedLeague ? (
              selectedLeague.teamList.map((t) => (
                <label
                  key={t.teamId}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-slate-800/60"
                >
                  <input
                    type="checkbox"
                    checked={!!checkedTeams[t.teamId]}
                    onChange={() => toggleTeam(t.teamId)}
                    className="h-4 w-4 rounded border-slate-500 bg-slate-900"
                  />
                  <span className="font-mono text-[10px] text-slate-500">#{t.teamId}</span>
                  <span className="truncate">{t.teamName || '—'}</span>
                </label>
              ))
            ) : (
              <p className="px-2 py-4 text-center text-[11px] text-slate-500">
                Chọn 1 giải đấu ở cột trái để liệt kê CLB.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleCrawlSelected}
            disabled={!selectedCount || working}
            className="btn-primary mt-3 text-xs"
          >
            {working ? 'Đang crawl…' : `↻ Crawl ${selectedCount} CLB đã chọn`}
          </button>
        </div>
      </div>
    </section>
  );
}

function TopPlayersCrawlerPanel({ token, liveScore, onStatus }) {
  const leagues = useMemo(() => {
    const map = {};
    (liveScore || []).forEach((m) => {
      if (!m.tournamentId) return;
      const key = String(m.tournamentId) + ':' + String(m.seasonId || '');
      if (!map[key]) {
        map[key] = {
          tournamentId: String(m.tournamentId),
          seasonId: String(m.seasonId || ''),
          name: m.league || 'Không rõ giải',
          logo: m.leagueLogo || '',
          count: 0,
        };
      }
      map[key].count += 1;
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [liveScore]);

  const [selectedKey, setSelectedKey] = useState('');
  const [categories, setCategories] = useState({ goals: true, assists: true, rating: false });
  const [forceRefresh, setForceRefresh] = useState(false);
  const [working, setWorking] = useState(false);

  const selected = useMemo(() => {
    if (!selectedKey) return null;
    return leagues.find((l) => `${l.tournamentId}:${l.seasonId}` === selectedKey) || null;
  }, [leagues, selectedKey]);

  async function handleCrawl() {
    if (!selected) return;
    const cats = Object.keys(categories).filter((k) => categories[k]);
    if (!cats.length) {
      onStatus('err', 'Chọn ít nhất 1 chỉ số.');
      return;
    }
    setWorking(true);
    try {
      const res = await apiCrawlTopPlayers(token, {
        tournamentId: selected.tournamentId,
        seasonId: selected.seasonId,
        categories: cats,
        forceRefresh,
      });
      const ok = (res.results || []).filter((r) => r.source === 'sofa').length;
      const cached = (res.results || []).filter((r) => r.source === 'sheet-cache').length;
      const err = (res.results || []).filter((r) => r.source === 'error' || r.source === 'empty').length;
      onStatus(
        'ok',
        `Crawl Top Player "${selected.name}" → ${ok} mới, ${cached} còn hạn, ${err} lỗi/trống.`
      );
    } catch (err) {
      onStatus('err', String(err.message || err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="glass p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-amber-300">
            🏆 Crawl Top Player
          </h2>
          <p className="text-[11px] text-slate-400">
            Cào bảng vua phá lưới / kiến tạo / rating theo giải đấu.
            Dữ liệu lưu vào sheet <code className="font-mono">TopPlayers</code> để app đọc trực tiếp.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={forceRefresh}
            onChange={(e) => setForceRefresh(e.target.checked)}
            className="h-4 w-4 rounded border-slate-500 bg-slate-900"
          />
          Force refresh
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-[2fr_1fr_auto]">
        <select
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          className="input"
        >
          <option value="">— Chọn giải đấu —</option>
          {leagues.map((l) => (
            <option key={`${l.tournamentId}:${l.seasonId}`} value={`${l.tournamentId}:${l.seasonId}`}>
              {l.name} · T#{l.tournamentId}/S#{l.seasonId || '?'} ({l.count})
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-200">
          {[
            { k: 'goals', label: '⚽ Bàn' },
            { k: 'assists', label: '🎯 Kiến tạo' },
            { k: 'rating', label: '⭐ Rating' },
          ].map((c) => (
            <label key={c.k} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={!!categories[c.k]}
                onChange={(e) => setCategories((s) => ({ ...s, [c.k]: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-500 bg-slate-900"
              />
              {c.label}
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={handleCrawl}
          disabled={!selected || working}
          className="btn-primary text-xs"
        >
          {working ? 'Đang crawl…' : selected ? `↻ Crawl "${selected.name}"` : 'Chọn giải để crawl'}
        </button>
      </div>
    </section>
  );
}

function TopLeaguesBatchPanel({ token, defaultN = 8, onStatus }) {
  const [n, setN] = useState(defaultN);
  const [teamLimit, setTeamLimit] = useState(30);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [cats, setCats] = useState({ goals: true, assists: true, rating: false });
  const [busy, setBusy] = useState('');
  const [lastReport, setLastReport] = useState(null);

  useEffect(() => {
    setN(defaultN);
  }, [defaultN]);

  async function runInfo() {
    setBusy('info');
    try {
      const res = await apiCrawlTopLeaguesInfo(token, { n, forceRefresh });
      const ok = (res.results || []).filter((r) => r.source === 'sofa').length;
      const cached = (res.results || []).filter((r) => r.source === 'sheet-cache').length;
      const fail = (res.results || []).filter((r) => r.source === 'error' || r.source === 'empty').length;
      onStatus('ok', `Crawl info ${n} giải: ${ok} mới, ${cached} còn hạn, ${fail} lỗi.`);
      setLastReport({ kind: 'info', data: res });
    } catch (err) {
      onStatus('err', String(err.message || err));
    } finally {
      setBusy('');
    }
  }

  async function runTeams() {
    setBusy('teams');
    try {
      const res = await apiCrawlTopLeaguesTeams(token, { n, teamLimit, forceRefresh });
      const totalOk = (res.results || []).reduce((s, r) => s + (r.success || 0), 0);
      const totalSkip = (res.results || []).reduce((s, r) => s + (r.skipped || 0), 0);
      const totalFail = (res.results || []).reduce((s, r) => s + (r.failed || 0), 0);
      onStatus('ok', `Crawl teams ${n} giải: ${totalOk} CLB mới, ${totalSkip} còn hạn TTL, ${totalFail} lỗi.`);
      setLastReport({ kind: 'teams', data: res });
    } catch (err) {
      onStatus('err', String(err.message || err));
    } finally {
      setBusy('');
    }
  }

  async function runTopPlayers() {
    const categories = Object.keys(cats).filter((k) => cats[k]);
    if (!categories.length) {
      onStatus('err', 'Chọn ít nhất 1 chỉ số.');
      return;
    }
    setBusy('topplayers');
    try {
      const res = await apiCrawlTopLeaguesTopPlayers(token, { n, categories, forceRefresh });
      const totalOk = (res.results || []).reduce((s, r) => s + (r.categoriesOk || 0), 0);
      const totalCache = (res.results || []).reduce((s, r) => s + (r.categoriesCached || 0), 0);
      const totalFail = (res.results || []).reduce((s, r) => s + (r.categoriesFailed || 0), 0);
      onStatus('ok', `Crawl TopPlayer ${n} giải: ${totalOk} mới, ${totalCache} còn hạn, ${totalFail} lỗi.`);
      setLastReport({ kind: 'topplayers', data: res });
    } catch (err) {
      onStatus('err', String(err.message || err));
    } finally {
      setBusy('');
    }
  }

  async function runAll() {
    const categories = Object.keys(cats).filter((k) => cats[k]);
    setBusy('all');
    try {
      const res = await apiCrawlTopLeaguesAll(token, { n, teamLimit, categories, forceRefresh });
      onStatus('ok', `Xong gói "tất cả" cho ${n} giải hàng đầu (info + teams + top-player).`);
      setLastReport({ kind: 'all', data: res });
    } catch (err) {
      onStatus('err', String(err.message || err));
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="glass p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-300">
            ⚡ Crawl hàng loạt – N giải hàng đầu
          </h2>
          <p className="text-[11px] text-slate-400">
            Dùng thứ tự trong <code className="font-mono">featured_tournament_ids</code> (đồng bộ từ SofaScore VN).
            Bấm "🏆 Giải mặc định (VN)" ở đầu trang trước nếu danh sách còn trống.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={forceRefresh}
            onChange={(e) => setForceRefresh(e.target.checked)}
            className="h-4 w-4 rounded border-slate-500 bg-slate-900"
          />
          Force refresh
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-[auto_auto_1fr_auto] md:items-end">
        <div>
          <label className="label text-[10px] uppercase tracking-widest text-slate-400">Số giải (N)</label>
          <input
            type="number"
            min={1}
            max={50}
            value={n}
            onChange={(e) => setN(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            className="input w-24"
          />
        </div>
        <div>
          <label className="label text-[10px] uppercase tracking-widest text-slate-400">Đội/giải</label>
          <input
            type="number"
            min={1}
            max={200}
            value={teamLimit}
            onChange={(e) => setTeamLimit(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
            className="input w-24"
          />
        </div>
        <div>
          <label className="label text-[10px] uppercase tracking-widest text-slate-400">Chỉ số Top Player</label>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-200">
            {[
              { k: 'goals', label: '⚽ Bàn' },
              { k: 'assists', label: '🎯 Kiến tạo' },
              { k: 'rating', label: '⭐ Rating' },
            ].map((c) => (
              <label key={c.k} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!!cats[c.k]}
                  onChange={(e) => setCats((s) => ({ ...s, [c.k]: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-500 bg-slate-900"
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={runInfo} disabled={!!busy} className="btn-ghost text-xs">
          {busy === 'info' ? 'Đang crawl…' : `📚 Info ${n} giải`}
        </button>
        <button type="button" onClick={runTeams} disabled={!!busy} className="btn-ghost text-xs">
          {busy === 'teams' ? 'Đang crawl…' : `👥 Đội bóng ${n} giải`}
        </button>
        <button type="button" onClick={runTopPlayers} disabled={!!busy} className="btn-ghost text-xs">
          {busy === 'topplayers' ? 'Đang crawl…' : `🏆 Top Player ${n} giải`}
        </button>
        <button type="button" onClick={runAll} disabled={!!busy} className="btn-primary text-xs">
          {busy === 'all' ? 'Đang crawl tất cả…' : `⚡ Tất cả (${n})`}
        </button>
      </div>

      {lastReport && <TopLeaguesReport report={lastReport} />}
    </section>
  );
}

function TopLeaguesReport({ report }) {
  const rows = useMemo(() => {
    if (!report) return [];
    if (report.kind === 'info') return report.data.results || [];
    if (report.kind === 'teams') return report.data.results || [];
    if (report.kind === 'topplayers') return report.data.results || [];
    if (report.kind === 'all') {
      const info = report.data.info?.results || [];
      const teams = report.data.teams?.results || [];
      const tp = report.data.topPlayers?.results || [];
      const byId = {};
      info.forEach((r) => (byId[r.tournamentId] = { ...(byId[r.tournamentId] || {}), ...r, infoSource: r.source }));
      teams.forEach((r) => (byId[r.tournamentId] = { ...(byId[r.tournamentId] || {}), ...r }));
      tp.forEach((r) => (byId[r.tournamentId] = { ...(byId[r.tournamentId] || {}), ...r }));
      return Object.values(byId);
    }
    return [];
  }, [report]);

  if (!rows.length) return null;

  return (
    <div className="mt-4 overflow-auto rounded-lg border border-white/10">
      <table className="w-full text-[11px]">
        <thead className="bg-slate-900/60 text-slate-400">
          <tr>
            <th className="px-2 py-1 text-left font-medium">Giải</th>
            <th className="px-2 py-1 text-right font-medium">Season</th>
            {(report.kind === 'teams' || report.kind === 'all') && (
              <>
                <th className="px-2 py-1 text-right font-medium">Teams ✓</th>
                <th className="px-2 py-1 text-right font-medium">Teams skip</th>
                <th className="px-2 py-1 text-right font-medium">Teams ✗</th>
              </>
            )}
            {(report.kind === 'topplayers' || report.kind === 'all') && (
              <>
                <th className="px-2 py-1 text-right font-medium">TP ✓</th>
                <th className="px-2 py-1 text-right font-medium">TP cache</th>
                <th className="px-2 py-1 text-right font-medium">TP ✗</th>
              </>
            )}
            {(report.kind === 'info' || report.kind === 'all') && (
              <th className="px-2 py-1 text-left font-medium">Info</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.tournamentId}-${i}`} className="border-t border-white/5">
              <td className="px-2 py-1">
                <div className="font-semibold">{r.name || '—'}</div>
                <div className="font-mono text-[10px] text-slate-500">#{r.tournamentId}</div>
              </td>
              <td className="px-2 py-1 text-right font-mono text-slate-400">{r.seasonId || '—'}</td>
              {(report.kind === 'teams' || report.kind === 'all') && (
                <>
                  <td className="px-2 py-1 text-right text-emerald-300">{r.success ?? '—'}</td>
                  <td className="px-2 py-1 text-right text-slate-400">{r.skipped ?? '—'}</td>
                  <td className="px-2 py-1 text-right text-rose-300">{r.failed ?? '—'}</td>
                </>
              )}
              {(report.kind === 'topplayers' || report.kind === 'all') && (
                <>
                  <td className="px-2 py-1 text-right text-emerald-300">{r.categoriesOk ?? '—'}</td>
                  <td className="px-2 py-1 text-right text-slate-400">{r.categoriesCached ?? '—'}</td>
                  <td className="px-2 py-1 text-right text-rose-300">{r.categoriesFailed ?? '—'}</td>
                </>
              )}
              {(report.kind === 'info' || report.kind === 'all') && (
                <td className="px-2 py-1 text-slate-300">{r.source || r.infoSource || '—'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
