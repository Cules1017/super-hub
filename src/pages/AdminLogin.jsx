import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ADMIN_TOKEN_ENV } from '../config/api.js';

const STORAGE_KEY = 'mega_hub_admin_token';

export function getStoredToken() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || '';
  } catch (_) {
    return '';
  }
}

export function setStoredToken(v) {
  try {
    sessionStorage.setItem(STORAGE_KEY, v);
  } catch (_) {
    /* noop */
  }
}

export function clearStoredToken() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (_) {
    /* noop */
  }
}

export default function AdminLogin() {
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const nav = useNavigate();

  function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    if (!token.trim()) {
      setErr('Vui lòng nhập Access Token.');
      return;
    }
    if (ADMIN_TOKEN_ENV && token !== ADMIN_TOKEN_ENV) {
      setErr('Token không hợp lệ.');
      return;
    }
    setStoredToken(token);
    nav('/secret-admin/panel', { replace: true });
  }

  return (
    <div className="mx-auto mt-10 max-w-md">
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-strong p-6"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-rose-400 to-red-500 text-lg">
            🔒
          </div>
          <div>
            <h1 className="text-lg font-bold">Admin · Secret Area</h1>
            <p className="text-xs text-slate-400">Chỉ dành cho quản trị viên được uỷ quyền.</p>
          </div>
        </div>

        <label className="label">Access Token</label>
        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="input"
          placeholder="Nhập token bí mật"
        />
        {err && <div className="mt-2 text-sm text-red-300">{err}</div>}

        <button type="submit" className="btn-primary mt-4 w-full">
          Đăng nhập
        </button>

        <p className="mt-3 text-[11px] text-slate-500">
          Token phải trùng với <code className="text-slate-300">ADMIN_TOKEN</code> trong{' '}
          <code className="text-slate-300">backend.gs</code>.
        </p>
      </motion.form>
    </div>
  );
}
