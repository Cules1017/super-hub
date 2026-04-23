import { useEffect, useRef } from 'react';
import { useConfig } from '../../hooks/useConfig.jsx';

/**
 * Slot quảng cáo lấy ID từ Settings (adsense_client + ads_slot_*).
 * Nếu chưa cấu hình AdSense thật -> render placeholder (an toàn cho dev).
 */
export default function AdsPlaceholder({ slot = 'header', className = '', label }) {
  const { get } = useConfig();
  const adsEnabled = get('ads_enabled', true);
  const slotEnabled = get(`ads_slot_${slot}_enabled`, true);
  const client = get('adsense_client', '');
  const slotId = get(`ads_slot_${slot}`, '');
  const ref = useRef(null);
  const pushed = useRef(false);

  const enabled =
    adsEnabled &&
    slotEnabled &&
    client &&
    slotId &&
    client.startsWith('ca-pub-') &&
    !client.includes('XXXX');

  useEffect(() => {
    if (!enabled || pushed.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch (_) {
      /* noop */
    }
  }, [enabled]);

  if (!adsEnabled || !slotEnabled) return null;

  if (!enabled) {
    return (
      <div
        className={`glass flex items-center justify-center text-xs uppercase tracking-widest text-slate-400 h-24 ${className}`}
        aria-label="ads-placeholder"
      >
        <span>Ads Slot · {label || slot} · id: {slotId || '—'}</span>
      </div>
    );
  }

  return (
    <div className={className} ref={ref}>
      <ins
        className="adsbygoogle block"
        style={{ display: 'block' }}
        data-ad-client={client}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
