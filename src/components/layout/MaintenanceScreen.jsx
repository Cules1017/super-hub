import { useConfig } from '../../hooks/useConfig.jsx';

export default function MaintenanceScreen() {
  const { get } = useConfig();
  return (
    <div className="glass mx-auto mt-10 max-w-2xl p-10 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/20 text-2xl">
        🛠
      </div>
      <h1 className="text-2xl font-bold">Hệ thống đang bảo trì</h1>
      <p className="mt-2 text-slate-400">
        {get('announcement', 'Chúng tôi sẽ quay lại trong ít phút. Xin cảm ơn.')}
      </p>
    </div>
  );
}
