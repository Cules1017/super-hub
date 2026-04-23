import { Helmet } from 'react-helmet-async';
import { useConfig } from '../../hooks/useConfig.jsx';

export default function SEO({ title, description, keywords, jsonLd }) {
  const { get } = useConfig();
  const finalTitle = title || get('meta_title', get('site_name', 'Mega Hub'));
  const finalDesc = description || get('meta_description', '');
  const finalKw = keywords || get('meta_keywords', '');

  return (
    <Helmet>
      <title>{finalTitle}</title>
      {finalDesc && <meta name="description" content={finalDesc} />}
      {finalKw && <meta name="keywords" content={finalKw} />}
      <meta property="og:title" content={finalTitle} />
      {finalDesc && <meta property="og:description" content={finalDesc} />}
      <meta property="og:type" content="website" />
      {jsonLd && (
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      )}
    </Helmet>
  );
}
