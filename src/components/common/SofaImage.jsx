import { useEffect, useMemo, useState } from 'react';

/**
 * Các host ảnh SofaScore có thể dùng thay thế cho nhau.
 * `api.sofascore.app` rất hay bị chặn 403 (hotlink protection / Cloudflare), nên ta ưu tiên
 * `img.sofascore.com` (CDN) và `api.sofascore.com` (origin công khai dùng trên sofascore.com).
 */
const SOFA_IMAGE_HOSTS = [
  'https://img.sofascore.com',
  'https://api.sofascore.com',
  'https://api.sofascore.app',
];

/**
 * Proxy ảnh công cộng. Khi Sofa trả 403 ở mọi host (đặc biệt là logo giải đấu
 * `unique-tournament/{id}/image`), ta đi qua `images.weserv.nl` — nó fetch ảnh
 * server-side, bỏ Referer, cache CDN, luôn trả 200 nếu ảnh tồn tại.
 */
function weservProxy(url) {
  if (!url) return '';
  // weserv yêu cầu URL không có scheme.
  const stripped = String(url).replace(/^https?:\/\//i, '');
  return 'https://images.weserv.nl/?url=' + encodeURIComponent(stripped) + '&default=1';
}

/**
 * Nhận 1 URL ảnh SofaScore bất kỳ -> trả về mảng URL fallback theo thứ tự ưu tiên.
 * Các URL ngoài SofaScore được trả về nguyên trạng (vẫn qua weserv ở cuối).
 */
function buildSofaFallbackList(src, extraFallbacks) {
  const list = [];
  const push = (u) => {
    if (!u) return;
    if (!list.includes(u)) list.push(u);
  };

  if (src) {
    const m = String(src).match(/^https?:\/\/[^/]+(\/.*)$/);
    const isSofa = m && /sofascore\.(app|com)/i.test(src);
    if (isSofa) {
      const path = m[1];
      // Logo giải đấu (`unique-tournament`) gần như luôn bị 403 ở mọi host -> đi thẳng proxy.
      const proxyFirst = /\/unique-tournament\//i.test(path);
      if (proxyFirst) {
        push(weservProxy('api.sofascore.com' + path));
        push(weservProxy('api.sofascore.app' + path));
        SOFA_IMAGE_HOSTS.forEach((host) => push(host + path));
      } else {
        SOFA_IMAGE_HOSTS.forEach((host) => push(host + path));
        SOFA_IMAGE_HOSTS.forEach((host) => push(weservProxy(host + path)));
      }
    } else {
      push(src);
      push(weservProxy(src));
    }
  }

  if (Array.isArray(extraFallbacks)) {
    extraFallbacks.forEach((x) => push(x));
  }

  return list;
}

/**
 * <img> thông minh cho ảnh SofaScore/logo đội bóng/cầu thủ.
 * - Gửi request với `referrerPolicy="no-referrer"` để bypass hotlink-protection dựa trên Referer.
 * - Nếu host đầu tiên 403/404 -> tự đổi sang host kế tiếp (img/api/app).
 * - Có thể truyền thêm `fallbacks` (vd avatar local) cho trường hợp cuối cùng.
 */
export default function SofaImage({
  src,
  fallbacks,
  alt = '',
  onError,
  referrerPolicy = 'no-referrer',
  crossOrigin,
  ...rest
}) {
  const list = useMemo(() => buildSofaFallbackList(src, fallbacks), [src, fallbacks]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [src, fallbacks]);

  if (!list.length) return null;

  const current = list[Math.min(idx, list.length - 1)];
  return (
    <img
      {...rest}
      src={current}
      alt={alt}
      referrerPolicy={referrerPolicy}
      crossOrigin={crossOrigin}
      loading={rest.loading || 'lazy'}
      onError={(e) => {
        if (idx < list.length - 1) {
          setIdx((n) => n + 1);
          return;
        }
        if (typeof onError === 'function') {
          onError(e);
        } else {
          e.currentTarget.style.display = 'none';
        }
      }}
    />
  );
}

export { buildSofaFallbackList };
