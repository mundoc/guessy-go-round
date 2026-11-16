// Returns only the visitor's 2-letter country code (e.g. {"country":"DE"}),
// which Netlify works out from the request. The game attaches it to its word
// stats uploads. No IP address is returned or stored.
export default async (request, context) => {
  const country = (context.geo && context.geo.country && context.geo.country.code) || null;
  return new Response(JSON.stringify({ country }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};

export const config = { path: '/api/geo' };
