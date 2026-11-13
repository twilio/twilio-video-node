const REQUEST_TIMEOUT_MS = 30_000;

/** True when the integration tests get their credentials from the vendor. */
function usingVendor(): boolean {
  return Boolean(process.env.VENDOR_URL);
}

// OIDC tokens are short-lived, so one is minted per call.
async function vendorToken(vendorUrl: string): Promise<string> {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    const token = process.env.VENDOR_TOKEN;
    if (!token) {
      throw new Error('VENDOR_URL is set, but there is no OIDC request token or VENDOR_TOKEN');
    }
    return token;
  }
  const url = new URL(requestUrl);
  url.searchParams.set('audience', vendorUrl);
  const response = await fetch(url, {
    headers: { Authorization: `bearer ${requestToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Could not mint an OIDC token for the vendor (${response.status})`);
  }
  const { value } = (await response.json()) as { value?: string };
  if (!value) {
    throw new Error('The OIDC token response carried no token');
  }
  return value;
}

/** Calls `action` on the credential vendor at `VENDOR_URL`. */
async function callVendor(
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const vendorUrl = process.env.VENDOR_URL;
  if (!vendorUrl) {
    throw new Error('VENDOR_URL is not set');
  }
  const token = await vendorToken(vendorUrl);
  const response = await fetch(vendorUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body: Record<string, unknown> | undefined;
  try {
    body = JSON.parse(text);
  } catch {
    // Reported below with the status.
  }
  if (!response.ok || !body) {
    const reason = typeof body?.error === 'string' ? body.error : 'no JSON error body';
    throw new Error(`Vendor action ${action} failed (${response.status}): ${reason}`);
  }
  return body;
}

export { callVendor, usingVendor };
