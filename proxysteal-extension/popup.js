const toggleBtn = document.getElementById('toggleBtn');
const statusBadge = document.getElementById('statusBadge');
const hostInput = document.getElementById('host');
const portInput = document.getElementById('port');
const protocolInput = document.getElementById('protocol');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');

let isActive = false;

// Load initial state
chrome.storage.local.get(['proxyConfig'], (result) => {
  if (result.proxyConfig) {
    const conf = result.proxyConfig;
    hostInput.value = conf.host || '';
    portInput.value = conf.port || '';
    protocolInput.value = conf.protocol || 'http';
    usernameInput.value = conf.username || '';
    passwordInput.value = conf.password || '';
    
    if (conf.isActive) {
      setUIActive(true);
    }
  }
});

function setUIActive(active) {
  isActive = active;
  if (active) {
    toggleBtn.textContent = 'Отключить';
    toggleBtn.classList.add('active');
    statusBadge.textContent = 'Подключен';
    statusBadge.classList.add('active');
    
    hostInput.disabled = true;
    portInput.disabled = true;
    protocolInput.disabled = true;
    usernameInput.disabled = true;
    passwordInput.disabled = true;
  } else {
    toggleBtn.textContent = 'Подключить';
    toggleBtn.classList.remove('active');
    statusBadge.textContent = 'Отключен';
    statusBadge.classList.remove('active');
    
    hostInput.disabled = false;
    portInput.disabled = false;
    protocolInput.disabled = false;
    usernameInput.disabled = false;
    passwordInput.disabled = false;
  }
}

toggleBtn.addEventListener('click', () => {
  if (isActive) {
    // Disable proxy
    chrome.proxy.settings.clear({ scope: 'regular' }, () => {
      chrome.storage.local.get(['proxyConfig'], (result) => {
        const conf = result.proxyConfig || {};
        conf.isActive = false;
        chrome.storage.local.set({ proxyConfig: conf }, () => {
          setUIActive(false);
        });
      });
    });
  } else {
    // Enable proxy
    const host = hostInput.value.trim();
    const port = parseInt(portInput.value.trim(), 10);
    const protocol = protocolInput.value;
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!host || isNaN(port)) {
      alert('Пожалуйста, введите корректный IP/Хост и порт');
      return;
    }

    const proxySettings = {
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme: protocol,
          host: host,
          port: port
        },
        bypassList: ["localhost", "127.0.0.1"]
      }
    };

    chrome.proxy.settings.set({ value: proxySettings, scope: 'regular' }, () => {
      const conf = {
        host,
        port,
        protocol,
        username,
        password,
        isActive: true
      };
      chrome.storage.local.set({ proxyConfig: conf }, () => {
        setUIActive(true);
      });
    });
  }
});