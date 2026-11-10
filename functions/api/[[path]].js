export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetUrl = 'https://salah-aya-wedding.vercel.app' + url.pathname + url.search;
  
  const headers = new Headers(context.request.headers);
  headers.set('host', 'salah-aya-wedding.vercel.app');
  headers.set('origin', 'https://salah-aya-wedding.vercel.app');

  const modifiedRequest = new Request(targetUrl, {
    method: context.request.method,
    headers: headers,
    body: context.request.body,
    redirect: 'follow'
  });

  try {
    const response = await fetch(modifiedRequest);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'تعذر الاتصال بقاعدة البيانات.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
