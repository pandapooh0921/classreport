const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 密码哈希函数，使用 Node.js crypto 实现，与 Cloudflare Worker 的 Web Crypto 行为一致
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return salt.toString('base64') + ':' + hash.toString('base64');
}

// 生成 8 位家长随机查看码，排除易混淆字符 (I, 1, O, 0, L, l)
function generateParentCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 30个字符
  let code = '';
  for (let i = 0; i < 8; i++) {
    const randomIndex = crypto.randomInt(0, chars.length);
    code += chars[randomIndex];
  }
  return code;
}

function generateSeedSql() {
  const configPath = path.join(__dirname, '..', 'class-config.json');
  if (!fs.existsSync(configPath)) {
    console.error('未找到 class-config.json 文件');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const sqlLines = [];

  sqlLines.push('-- 自动生成的种子数据');
  sqlLines.push('PRAGMA foreign_keys = ON;');
  sqlLines.push('');

  // 1. 插入学年
  sqlLines.push('-- 学年数据');
  sqlLines.push(`INSERT OR IGNORE INTO academic_years (id, display_name, is_current) VALUES ('${config.academicYear}', '${config.academicYear}学年', 1);`);
  sqlLines.push('');

  // 2. 插入班级/分组
  sqlLines.push('-- 班级数据');
  config.classes.forEach(c => {
    sqlLines.push(`INSERT OR IGNORE INTO student_groups (id, academic_year_id, name, name_en, name_ms) VALUES ('${c.id}', '${config.academicYear}', '${c.name}', '${c.name_en || c.name}', '${c.name_ms || c.name}');`);
  });
  sqlLines.push('');

  // 3. 插入科目
  sqlLines.push('-- 科目数据');
  config.subjects.forEach(s => {
    sqlLines.push(`INSERT OR IGNORE INTO subjects (code, display_name, display_name_en, display_name_ms) VALUES ('${s.code}', '${s.display}', '${s.display_en || s.display}', '${s.display_ms || s.display}');`);
  });
  sqlLines.push('');

  // 4. 插入科目与班级映射
  sqlLines.push('-- 科目与班级映射数据');
  config.subjects.forEach(s => {
    s.classes.forEach(classId => {
      sqlLines.push(`INSERT OR IGNORE INTO subject_groups (subject_code, group_id) VALUES ('${s.code}', '${classId}');`);
    });
  });
  sqlLines.push('');

  // 5. 插入教师（密码默认与用户名相同，第一次登录可更改）
  sqlLines.push('-- 教师数据');
  const teacherIdMap = {}; // 用来映射用户名到虚拟自增 ID，但在 SQL 中可以直接使用子查询或通过用户名插入
  config.teachers.forEach((t, index) => {
    const defaultPassword = t.username; // 默认密码同用户名
    const hashedPassword = hashPassword(defaultPassword);
    sqlLines.push(`INSERT OR IGNORE INTO teachers (id, username, display_name, display_name_en, display_name_ms, password, role) VALUES (${index + 1}, '${t.username}', '${t.display}', '${t.display_en || t.display}', '${t.display_ms || t.display}', '${hashedPassword}', '${t.role}');`);
  });
  sqlLines.push('');

  // 6. 插入教师与科目映射
  sqlLines.push('-- 教师与科目映射数据');
  config.teachers.forEach((t, index) => {
    t.subjects.forEach(subj => {
      // 教师的 ID 是 index + 1
      sqlLines.push(`INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_code) VALUES (${index + 1}, '${subj}');`);
    });
  });
  sqlLines.push('');

  // 7. 插入学生及班级学年关联
  sqlLines.push('-- 学生与学年班级关联数据');
  config.students.forEach((s, index) => {
    const studentId = index + 1;
    const parentCode = generateParentCode();
    const photoUrl = `photos/${s.student_number}.jpg`;
    
    // 写入学生主表
    sqlLines.push(`INSERT OR IGNORE INTO students (id, student_number, name, name_en, gender, is_boarding, parent_phone, student_phone, address, siblings, photo_url, status, parent_code) VALUES (${studentId}, '${s.student_number}', '${s.name}', '${s.name_en}', '${s.gender}', ${s.is_boarding ? 1 : 0}, '${s.parent_phone || ''}', '${s.student_phone || ''}', '${s.address || ''}', '${s.siblings || ''}', '${photoUrl}', '${s.status}', '${parentCode}');`);
    
    // 关联班级学年
    sqlLines.push(`INSERT OR IGNORE INTO student_class_relations (student_id, group_id) VALUES (${studentId}, '${s.class_id}');`);
  });
  sqlLines.push('');

  // 写入 SQL 文件
  const scriptsDir = path.join(__dirname);
  if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir);
  }
  const outputPath = path.join(scriptsDir, '0002_seed.sql');
  fs.writeFileSync(outputPath, sqlLines.join('\n'), 'utf8');
  console.log(`成功生成 SQL 种子数据至: ${outputPath}`);
}

generateSeedSql();
