'use strict';

// Backend requests made on behalf of a signed-in desktop user require both
// credentials: the per-install token protects the local port, and the session
// JWT identifies/authorizes the user.
function authedBackendHeaders(localHeaders, sessionToken, extraHeaders = {}) {
  return {
    'content-type': 'application/json',
    ...(localHeaders || {}),
    Authorization: `Bearer ${sessionToken}`,
    ...extraHeaders,
  };
}

module.exports = { authedBackendHeaders };
