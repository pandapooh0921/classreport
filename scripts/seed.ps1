# PowerShell script to generate seed SQL with PBKDF2 hashing using .NET
$configFile = Join-Path $PSScriptRoot "..\class-config.json"
$outputFile = Join-Path $PSScriptRoot "0002_seed.sql"

if (-not (Test-Path $configFile)) {
    Write-Error "class-config.json not found!"
    exit 1
}

$config = Get-Content $configFile -Raw | ConvertFrom-Json

# Helper to generate random 8-character parent code (excluding I, 1, O, 0, L, l)
function New-ParentCode {
    $chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    $code = ""
    for ($i = 0; $i -lt 8; $i++) {
        $randomIndex = Get-Random -Minimum 0 -Maximum $chars.Length
        $code += $chars[$randomIndex]
    }
    return $code
}

# Helper to generate PBKDF2 SHA-256 hash matching Web Crypto
function Get-Pbkdf2Hash ($password) {
    $salt = New-Object Byte[] 16
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($salt)
    
    $passwordBytes = [System.Text.Encoding]::UTF8.GetBytes($password)
    
    # Use Rfc2898DeriveBytes with SHA256 (requires modern .NET / PowerShell)
    $pbkdf2 = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($passwordBytes, $salt, 100000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
    $hash = $pbkdf2.GetBytes(32)
    
    $saltB64 = [Convert]::ToBase64String($salt)
    $hashB64 = [Convert]::ToBase64String($hash)
    
    # Use curly braces to delimit variables in PowerShell to avoid drive colon issues
    return "${saltB64}:${hashB64}"
}

$sql = @()
$sql += "-- Auto-generated Seed Data"
$sql += "PRAGMA foreign_keys = ON;"
$sql += ""

# 1. Academic Years
$sql += "-- Academic Year Data"
$year = $config.academicYear
$sql += "INSERT OR IGNORE INTO academic_years (id, display_name, is_current) VALUES ('$year', '${year}学年', 1);"
$sql += ""

# 2. Classes
$sql += "-- Classes Data"
foreach ($c in $config.classes) {
    $cid = $c.id
    $cname = $c.name
    $cname_en = $c.name_en
    $cname_ms = $c.name_ms
    $sql += "INSERT OR IGNORE INTO student_groups (id, academic_year_id, name, name_en, name_ms) VALUES ('$cid', '$year', '$cname', '$cname_en', '$cname_ms');"
}
$sql += ""

# 3. Subjects
$sql += "-- Subjects Data"
foreach ($s in $config.subjects) {
    $scode = $s.code
    $sdisp = $s.display
    $sdisp_en = $s.display_en
    $sdisp_ms = $s.display_ms
    $semo = $s.emoji
    $sql += "INSERT OR IGNORE INTO subjects (code, display_name, display_name_en, display_name_ms, emoji) VALUES ('$scode', '$sdisp', '$sdisp_en', '$sdisp_ms', '$semo');"
}
$sql += ""

# 4. Subject-Group Maps
$sql += "-- Subject-Group Map Data"
foreach ($s in $config.subjects) {
    $scode = $s.code
    foreach ($classId in $s.classes) {
        $sql += "INSERT OR IGNORE INTO subject_groups (subject_code, group_id) VALUES ('$scode', '$classId');"
    }
}
$sql += ""

# 5. Teachers & 6. Teacher-Subject Maps
$sql += "-- Teachers and Subject Map Data"
$tIndex = 1
foreach ($t in $config.teachers) {
    $tusr = $t.username
    $tdisp = $t.display
    $tdisp_en = $t.display_en
    $tdisp_ms = $t.display_ms
    $trole = $t.role
    
    Write-Host "Hashing password for $tusr..."
    $hashedPassword = Get-Pbkdf2Hash -password $tusr
    
    $sql += "INSERT OR IGNORE INTO teachers (id, username, display_name, display_name_en, display_name_ms, password, role) VALUES ($tIndex, '$tusr', '$tdisp', '$tdisp_en', '$tdisp_ms', '$hashedPassword', '$trole');"
    
    foreach ($subj in $t.subjects) {
        $sql += "INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_code) VALUES ($tIndex, '$subj');"
    }
    $tIndex++
}
$sql += ""

# 7. Students & relations
$sql += "-- Students and Class Map Data"
$sIndex = 1
foreach ($s in $config.students) {
    $snum = $s.student_number
    $sname = $s.name
    $sname_en = $s.name_en
    $sgend = $s.gender
    $isB = if ($s.is_boarding) { 1 } else { 0 }
    $pphone = $s.parent_phone
    $sphone = $s.student_phone
    $saddr = $s.address
    $ssib = $s.siblings
    $sstatus = $s.status
    $sclass = $s.class_id
    
    $parentCode = New-ParentCode
    $photoUrl = "photos/${snum}.jpg"
    
    $sql += "INSERT OR IGNORE INTO students (id, student_number, name, name_en, gender, is_boarding, parent_phone, student_phone, address, siblings, photo_url, status, parent_code) VALUES ($sIndex, '$snum', '$sname', '$sname_en', '$sgend', $isB, '$pphone', '$sphone', '$saddr', '$ssib', '$photoUrl', '$sstatus', '$parentCode');"
    $sql += "INSERT OR IGNORE INTO student_class_relations (student_id, group_id) VALUES ($sIndex, '$sclass');"
    $sIndex++
}
$sql += ""

# Write to file (using UTF8 to support Chinese student names)
$sql | Out-File -FilePath $outputFile -Encoding utf8 -Force
Write-Host "SQL seed data generated at: $outputFile"
