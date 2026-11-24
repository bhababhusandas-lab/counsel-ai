// Runtime API configuration. Set PRODUCTION_API_URL to your deployed backend;
// no rebuild is needed because this file is served as-is from /counselai-config.js.
//
// When the page is opened from this machine (localhost) OR from another device on
// the same LAN (e.g. a phone at http://192.168.x.x:4000), point at the backend on
// the SAME host, port 8080. Without this, local and LAN browsing would call the
// deployed production API — which fails CORS and surfaces as "Network Error".
(function () {
  // Your deployed backend. Change this to point at your own API server.
  var PRODUCTION_API_URL = 'https://api.counselai.com';

  var h = window.location.hostname;
  var isLoopback = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(h);
  // RFC1918 private ranges + mDNS .local names
  var isLan = /^10\./.test(h)
    || /^192\.168\./.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    || /\.local$/.test(h);

  window.__COUNSELAI_CONFIG__ = {
    apiUrl: (isLoopback || isLan)
      ? window.location.protocol + '//' + h + ':8080'
      : PRODUCTION_API_URL
  };
})();
