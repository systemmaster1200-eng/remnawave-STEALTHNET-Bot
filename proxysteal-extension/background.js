let currentConfig = null;

chrome.storage.local.get(['proxyConfig'], (result) => {
  if (result.proxyConfig) {
    currentConfig = result.proxyConfig;
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.proxyConfig) {
    currentConfig = changes.proxyConfig.newValue;
  }
});

// Provide credentials for HTTP proxies
chrome.webRequest.onAuthRequired.addListener(
  function(details, callbackFn) {
    if (currentConfig && currentConfig.isActive && currentConfig.username && currentConfig.password) {
      // Only provide credentials if the request is for our proxy
      if (details.isProxy) {
        callbackFn({
          authCredentials: {
            username: currentConfig.username,
            password: currentConfig.password
          }
        });
        return;
      }
    }
    callbackFn();
  },
  { urls: ["<all_urls>"] },
  ['asyncBlocking']
);