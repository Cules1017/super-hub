import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="glass mx-auto mt-10 max-w-xl p-10 text-center">
      <div className="text-6xl font-black tracking-tight">404</div>
      <p className="mt-2 text-slate-400">Trang không tồn tại hoặc đã bị di chuyển.</p>
      <Link to="/" className="btn-primary mt-5">← Về trang chủ</Link>
    </div>
  );
}
