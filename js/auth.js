// Retrieve or set default worker URL
let WORKER_URL = localStorage.getItem('report_worker_url') || 'https://hualian-reports-worker.hualianj2lclassreport.workers.dev';

function setWorkerUrl(url) {
  // Strip trailing slash
  if (url.endsWith('/')) {
    url = url.substring(0, url.length - 1);
  }
  localStorage.setItem('report_worker_url', url);
  WORKER_URL = url;
}

function getToken() {
  return sessionStorage.getItem('report_token') || localStorage.getItem('report_token');
}

function setToken(token, remember = false) {
  if (remember) {
    localStorage.setItem('report_token', token);
  } else {
    sessionStorage.setItem('report_token', token);
  }
}

function clearToken() {
  sessionStorage.removeItem('report_token');
  localStorage.removeItem('report_token');
}

function getUser() {
  const u = sessionStorage.getItem('report_user') || localStorage.getItem('report_user');
  return u ? JSON.parse(u) : null;
}

function setUser(user, remember = false) {
  const userStr = JSON.stringify(user);
  if (remember) {
    localStorage.setItem('report_user', userStr);
  } else {
    sessionStorage.setItem('report_user', userStr);
  }
}

function clearUser() {
  sessionStorage.removeItem('report_user');
  localStorage.removeItem('report_user');
}

// Wrapper for fetch API with auto authentication & error handling
async function fetchWithAuth(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }
  
  const requestUrl = WORKER_URL + path;
  
  try {
    const res = await fetch(requestUrl, { ...options, headers });
    
    // Automatically log out and redirect on 401 Unauthorized
    if (res.status === 401) {
      clearToken();
      clearUser();
      if (!window.location.pathname.endsWith('teacher-login.html')) {
        window.location.href = 'teacher-login.html';
      }
      throw new Error('会话过期，请重新登录 / Session expired');
    }
    
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP Error ${res.status}`);
    }
    
    return data;
  } catch (err) {
    console.error(`Fetch failed for ${path}:`, err);
    throw err;
  }
}

// Check auth state on non-login pages
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  if (!path.endsWith('teacher-login.html') && !path.endsWith('parent.html')) {
    const token = getToken();
    const user = getUser();
    if (!token || !user) {
      clearToken();
      clearUser();
      window.location.href = 'teacher-login.html';
    }
  }
});
