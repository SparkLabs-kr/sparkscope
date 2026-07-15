#!/usr/bin/env node
/**
 * Pre-commit secret detection
 * API 키, 토큰, 시크릿 패턴을 감지하여 커밋 차단
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SECRETS_PATTERNS = [
  {
    name: 'Anthropic API Key',
    pattern: /sk-ant-[a-zA-Z0-9_]{48,}/g,
    examples: '(실제 키 형식)',
  },
  {
    name: 'Supabase Key',
    pattern: /supabase_[a-z0-9]{20,}|neon_[a-z0-9]{20,}/gi,
    examples: '(실제 키 형식)',
  },
  {
    name: 'Real Database URL',
    pattern: /(postgres|mysql):\/\/[a-zA-Z0-9]+:[a-zA-Z0-9]+@[a-z0-9\.\-]+\.[a-z]{2,}/gi,
    examples: '(실제 연결 문자열)',
  },
  {
    name: 'Resend API Key',
    pattern: /re_[a-zA-Z0-9]{20,}/g,
    examples: '(실제 키 형식)',
  },
  {
    name: 'AWS Access Key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    examples: '(AWS 키 형식)',
  },
  {
    name: 'Private Key File',
    pattern: /-----BEGIN (RSA|DSA|EC|PGP|OPENSSH|ENCRYPTED) PRIVATE KEY-----/g,
    examples: '(개인 키 시작)',
  },
  {
    name: 'Bearer Token',
    pattern: /bearer\s+[a-zA-Z0-9\.\-_]{40,}/gi,
    examples: '(토큰 형식)',
  },
  {
    name: 'GitHub Token',
    pattern: /gh[ou]_[a-zA-Z0-9_]{36,}/g,
    examples: '(GitHub 토큰)',
  },
];

function getGitStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM').toString();
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function checkFile(filePath) {
  const content = getFileContent(filePath);
  if (!content) return [];

  const findings = [];

  for (const { name, pattern, examples } of SECRETS_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          findings.push({
            file: filePath,
            line: i + 1,
            secret: name,
            example: examples,
          });
          pattern.lastIndex = 0; // Reset regex state
        }
      }
    }
  }

  return findings;
}

function main() {
  const stagedFiles = getGitStagedFiles();

  if (stagedFiles.length === 0) {
    console.log('✅ 스테이징된 파일이 없습니다.');
    process.exit(0);
  }

  let hasSecrets = false;
  const allFindings = [];

  console.log('🔐 API 키·토큰·시크릿 검사 중...\n');

  for (const file of stagedFiles) {
    // 제외할 파일
    if (
      file.includes('node_modules') ||
      file.includes('.next') ||
      file.includes('.git') ||
      file === 'gitleaks.toml' ||
      file === '.gitleaksignore'
    ) {
      continue;
    }

    const findings = checkFile(file);
    if (findings.length > 0) {
      hasSecrets = true;
      allFindings.push(...findings);
    }
  }

  if (hasSecrets) {
    console.error('❌ 검사 실패: 다음 파일에서 민감한 정보가 발견되었습니다:\n');
    allFindings.forEach(({ file, line, secret, example }) => {
      console.error(`  📄 ${file}:${line}`);
      console.error(`     ${secret} (예: ${example})`);
    });
    console.error('\n해결 방법:');
    console.error('  1. 파일에서 민감한 정보를 제거하세요');
    console.error('  2. git add 로 다시 스테이징하세요');
    console.error('  3. git commit 을 다시 시도하세요\n');
    console.error('우회: git commit --no-verify (권장하지 않음)\n');
    process.exit(1);
  }

  console.log('✅ 보안 검사 통과\n');
  process.exit(0);
}

main();
