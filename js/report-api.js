const ReportAPI = {
  // ========== Internal: Check if backend is reachable ==========
  _offlineMode: false,
  _offlineChecked: false,

  async _checkOnline() {
    if (this._offlineChecked) return !this._offlineMode;
    try {
      const res = await fetch(WORKER_URL + '/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + (getToken() || 'test') }
      });
      this._offlineMode = false;
    } catch (e) {
      console.warn('⚠️ Backend unreachable, switching to offline mode');
      this._offlineMode = true;
    }
    this._offlineChecked = true;
    return !this._offlineMode;
  },

  // ========== 1. Auth APIs (with offline fallback) ==========
  async login(username, password, remember = false) {
    // Try backend first
    try {
      const res = await fetch(WORKER_URL + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (res.ok) {
        const data = await res.json();
        setToken(data.token, remember);
        setUser(data.teacher, remember);
        this._offlineMode = false;
        this._offlineChecked = true;
        return data;
      }

      const errData = await res.json().catch(() => ({}));
      // If backend returns auth error, throw it (don't fallback)
      throw new Error(errData.error || '登录失败 / Login failed');
    } catch (e) {
      // Only fallback to offline if it's a NETWORK error, not auth error
      if (e.message.includes('登录失败') || e.message.includes('Login failed')) {
        throw e;
      }
      console.warn('Backend unreachable, trying offline login...');
    }

    // OFFLINE LOGIN: Check against class-config.json
    const cfg = await LocalData.loadConfig();
    const teacher = (cfg.teachers || []).find(t =>
      t.username === username && t.password === password
    );
    if (!teacher) {
      throw new Error('用户名或密码错误 / Invalid username or password');
    }

    const user = {
      username: teacher.username,
      display_name: teacher.name,
      display_name_en: teacher.name_en,
      display_name_ms: teacher.name_ms,
      role: teacher.role,
      subjects: teacher.subjects
    };

    // Generate a fake token for offline mode
    const fakeToken = 'offline_' + btoa(username + ':' + Date.now());
    setToken(fakeToken, remember);
    setUser(user, remember);
    this._offlineMode = true;
    this._offlineChecked = true;
    console.log('📦 Logged in OFFLINE as:', teacher.name);
    // Stay in offline mode for the entire session
    this._offlineMode = true;
    this._offlineChecked = true;
    return { token: fakeToken, teacher: user, offline: true };
  },

  async logout() {
    try {
      await fetchWithAuth('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout request failed', e);
    } finally {
      clearToken();
      clearUser();
      window.location.href = 'teacher-login.html';
    }
  },

  async changePassword(oldPassword, newPassword) {
    return fetchWithAuth('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    });
  },

  // ========== 2. Teacher Report APIs (with offline fallback) ==========
  async getMyReports() {
    // Try backend first
    try {
      const online = await this._checkOnline();
      if (online) {
        return await fetchWithAuth('/api/reports/my-subjects', { method: 'GET' });
      }
    } catch (e) {
      console.warn('Backend getMyReports failed, using local data');
    }

    // OFFLINE FALLBACK: Build from class-config.json + localStorage
    console.log('📦 Using offline mode for getMyReports');
    const cfg = await LocalData.loadConfig();
    const user = getUser();
    const year = cfg.currentAcademicYear || '2026';

    let assignedSubjects;
    if (user && user.role === 'form_teacher') {
      assignedSubjects = cfg.subjects || [];
    } else if (user) {
      const teacher = (cfg.teachers || []).find(t => t.username === user.username);
      const subjectCodes = teacher ? teacher.subjects : [];
      assignedSubjects = (cfg.subjects || []).filter(s =>
        subjectCodes.includes('*') || subjectCodes.includes(s.code)
      );
    } else {
      assignedSubjects = cfg.subjects || [];
    }

    const activeStudents = LocalData.getActiveStudents(year);
    const subjects = assignedSubjects.map(sub => ({
      code: sub.code,
      display_name: sub.name,
      display_name_en: sub.name_en,
      display_name_ms: sub.name_ms,
      emoji: sub.emoji,
      students: activeStudents.map(st => {
        const localReport = LocalData.getReportLocal(year, st.studentId, sub.code);
        return {
          id: parseInt(st.studentId) || 0,
          student_number: st.studentId,
          name: st.nameZh,
          name_en: st.nameEn,
          gender: st.gender,
          is_boarding: st.hostel ? 1 : 0,
          feedback: localReport ? localReport.feedback : '',
          is_complete: localReport ? localReport.isComplete : 0,
          siblings: st.siblings || '',
          _raw: st
        };
      })
    }));

    return { subjects };
  },

  async saveReport(studentId, subjectCode, feedback, isComplete) {
    // Try backend first
    try {
      const online = await this._checkOnline();
      if (online) {
        return await fetchWithAuth('/api/reports/' + studentId + '/' + subjectCode, {
          method: 'PUT',
          body: JSON.stringify({ feedback, is_complete: isComplete ? 1 : 0 })
        });
      }
    } catch (e) {
      console.warn('Backend saveReport failed, saving locally');
    }

    // OFFLINE FALLBACK: Save to localStorage
    const cfg = await LocalData.loadConfig();
    const year = cfg.currentAcademicYear || '2026';
    LocalData.saveReportLocal(year, String(studentId), subjectCode, feedback, isComplete);
    return { success: true, offline: true };
  },

  async markSubjectComplete(subjectCode) {
    try {
      const online = await this._checkOnline();
      if (online) {
        return await fetchWithAuth('/api/reports/mark-complete/' + subjectCode, {
          method: 'POST'
        });
      }
    } catch (e) {
      console.warn('Backend markSubjectComplete failed, saving locally');
    }

    // OFFLINE FALLBACK
    const cfg = await LocalData.loadConfig();
    const year = cfg.currentAcademicYear || '2026';
    const activeStudents = LocalData.getActiveStudents(year);
    activeStudents.forEach(st => {
      const existing = LocalData.getReportLocal(year, st.studentId, subjectCode);
      LocalData.saveReportLocal(year, st.studentId, subjectCode,
        existing ? existing.feedback : '', true);
    });
    return { success: true, offline: true };
  },

  // ========== 3. Form Teacher Dashboard APIs (with offline fallback) ==========
  async getFTClassSummary() {
    try {
      const online = await this._checkOnline();
      if (online) {
        return await fetchWithAuth('/api/form-teacher/summary', { method: 'GET' });
      }
    } catch (e) {
      console.warn('Backend getFTClassSummary failed, building from local data');
    }

    // OFFLINE FALLBACK
    console.log('📦 Using offline mode for class summary');
    const cfg = await LocalData.loadConfig();
    const year = cfg.currentAcademicYear || '2026';
    const allStudents = LocalData.getAllStudents(year);
    const subjects = cfg.subjects || [];

    const students = allStudents.map(st => ({
      id: parseInt(st.studentId) || 0,
      student_number: st.studentId,
      name: st.nameZh,
      name_en: st.nameEn,
      gender: st.gender,
      is_boarding: st.hostel ? 1 : 0,
      status: st.status,
      siblings: st.siblings || '',
      _raw: st
    }));

    const reports = [];
    allStudents.forEach(st => {
      subjects.forEach(sub => {
        const r = LocalData.getReportLocal(year, st.studentId, sub.code);
        if (r) {
          reports.push({
            student_id: parseInt(st.studentId) || 0,
            subject_code: sub.code,
            feedback: r.feedback,
            is_complete: r.isComplete
          });
        }
      });
    });

    return {
      students,
      subjects: subjects.map(s => ({
        code: s.code,
        display_name: s.name,
        display_name_en: s.name_en,
        display_name_ms: s.name_ms,
        emoji: s.emoji
      })),
      reports,
      overall_progress: { total: allStudents.length * subjects.length, filled: reports.length }
    };
  },

  async getFTGenerateLinks() {
    return fetchWithAuth('/api/form-teacher/generate-links', { method: 'GET' });
  },

  async resetFTTeacherPassword(username, newPassword) {
    return fetchWithAuth('/api/form-teacher/reset-password', {
      method: 'POST',
      body: JSON.stringify({ username, new_password: newPassword })
    });
  },

  async changeFTStudentStatus(studentNumber, status) {
    return fetchWithAuth('/api/form-teacher/change-student-status', {
      method: 'POST',
      body: JSON.stringify({ student_number: studentNumber, status: status })
    });
  },

  async getFTAnalytics() {
    return fetchWithAuth('/api/form-teacher/analytics', { method: 'GET' });
  },

  async importComments(subjectCode, comments) {
    return fetchWithAuth('/api/form-teacher/import-comments', {
      method: 'POST',
      body: JSON.stringify({ subject_code: subjectCode, comments })
    });
  },

  // ========== 4. Parent View API (No Auth) ==========
  async getParentReport(code) {
    const res = await fetch(WORKER_URL + '/api/parent/report/' + code);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw {
        message: data.error || '获取报告失败 / Failed to retrieve report',
        rate_limited: data.rate_limited || false,
        status: res.status
      };
    }
    return data;
  }
};
