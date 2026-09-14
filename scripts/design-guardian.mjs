#!/usr/bin/env node
/**
 * SPECTRE DESIGN GUARDIAN
 * Scans CSS/JSX files for design system violations.
 * Run: node scripts/design-guardian.mjs [path]
 * Default: scans all src/ dirs across apps
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const VIOLATIONS = [];

// ============================================================
// RULES
// ============================================================

// Colors that are BANNED in dark-mode context (outside of day-mode blocks)
const BANNED_HEX_COLORS = [
  { pattern: /#1a1a2e/gi, fix: 'var(--bg-elevated) or var(--bg-surface)' },
  { pattern: /#1e1e2e/gi, fix: 'var(--bg-elevated)' },
  { pattern: /#2d2d3d/gi, fix: 'var(--bg-hover)' },
  { pattern: /#f5f5f5/gi, fix: 'BANNED - Use var(--bg-surface) or a day-mode variable' },
  { pattern: /#f8f8f8/gi, fix: 'BANNED - Spectre is dark-first' },
  { pattern: /#333333/gi, fix: 'var(--text-secondary) - never hardcode gray text' },
  { pattern: /#666666/gi, fix: 'var(--text-tertiary)' },
  { pattern: /#999999/gi, fix: 'var(--text-muted)' },
];

// Colors that are OK inside day-mode blocks but banned outside
const DARK_ONLY_BANNED_HEX = [
  { pattern: /#0f172a/gi, fix: 'Only use #0f172a inside .app-day-mode blocks. In dark mode use var(--text-primary)' },
  { pattern: /#ffffff(?![\da-f])/gi, fix: 'Only use #ffffff inside .app-day-mode blocks. In dark mode use var(--text-primary)' },
];

const BANNED_PATTERNS = [
  // Wrong fonts
  { pattern: /font-family:\s*['"]?(Arial|Helvetica|Roboto)(?!.*var)/gi, fix: 'Use var(--font-body) for text, var(--font-display) for headings, var(--font-mono) for numbers', cssOnly: false },
  { pattern: /font-family:\s*['"]?Inter(?!.*var)/gi, fix: 'Use var(--font-body) not raw "Inter"', cssOnly: false },
  { pattern: /font-family:\s*['"]?Space Grotesk(?!.*var)/gi, fix: 'Use var(--font-display) not raw "Space Grotesk"', cssOnly: false },

  // Wrong border radius (hardcoded instead of variable) - only flag in non-mobile CSS
  { pattern: /border-radius:\s*6px/g, fix: 'Use var(--radius-sm) (8px)', cssOnly: true },
  { pattern: /border-radius:\s*14px/g, fix: 'Use var(--radius-lg) (16px)', cssOnly: true },
  { pattern: /border-radius:\s*20px/g, fix: 'Use var(--radius-xl) (24px)', cssOnly: true },

  // Banned UI patterns (skip in day-mode context)
  { pattern: /background:\s*linear-gradient\([^)]*#[4-9a-f]{2}[4-9a-f]{2}ff/gi, fix: 'Bright gradient backgrounds are BANNED. Use subtle glass gradients.', cssOnly: true },

  // External icon imports in research app
  { pattern: /from\s+['"]lucide-react['"]/g, fix: 'BANNED in research app - Use spectreIcons from @/icons/spectreIcons', cssOnly: false },
  { pattern: /from\s+['"]react-icons/g, fix: 'BANNED - Use spectreIcons from @/icons/spectreIcons', cssOnly: false },
  { pattern: /from\s+['"]@heroicons/g, fix: 'BANNED - Use spectreIcons from @/icons/spectreIcons', cssOnly: false },
  { pattern: /from\s+['"]@fortawesome/g, fix: 'BANNED - Use spectreIcons from @/icons/spectreIcons', cssOnly: false },

  // AI labeling
  { pattern: /AI.Generated|AI.Powered|Powered by AI/g, fix: 'BANNED - AI is invisible in Spectre. Remove all AI labeling.', cssOnly: false },

  // Spinner usage
  { pattern: /@keyframes\s+spin\b/gi, fix: 'BANNED - Use skeleton shimmer loading, never spinners', cssOnly: true },
  { pattern: /className=.*spinner/gi, fix: 'BANNED - Use skeleton shimmer, never spinners', cssOnly: false },
  { pattern: /animation:.*spin\s/gi, fix: 'BANNED - Use skeleton shimmer, never spinner animations', cssOnly: true },
];

// ============================================================
// CSS CONTEXT TRACKING
// ============================================================

// Tracks whether we're inside a day-mode selector block by counting braces.
// When we see a selector containing "day-mode" or "day_mode", we mark the
// brace depth at which it opens, and skip violations until that block closes.
function buildDayModeLineSet(lines) {
  const dayModeLines = new Set();
  let braceDepth = 0;
  let dayModeDepth = -1; // -1 means not inside a day mode block

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line opens a day-mode selector
    if (dayModeDepth === -1 && /day-mode|day_mode|\.[\w-]+-day\b|\.[\w-]+--day\b/.test(line) && line.includes('{')) {
      dayModeDepth = braceDepth;
    }

    // Count braces
    for (const ch of line) {
      if (ch === '{') {
        braceDepth++;
      } else if (ch === '}') {
        braceDepth--;
        // If we close the day-mode block
        if (dayModeDepth !== -1 && braceDepth <= dayModeDepth) {
          dayModeDepth = -1;
        }
      }
    }

    // If we're inside a day-mode block, mark this line
    if (dayModeDepth !== -1) {
      dayModeLines.add(i);
    }

    // Also check for day-mode selector that opens on a different line
    if (dayModeDepth === -1 && /day-mode|day_mode|\.[\w-]+-day\b|\.[\w-]+--day\b/.test(line) && !line.includes('{')) {
      // Selector continues to next line - peek ahead for opening brace
      for (let j = i + 1; j < lines.length && j < i + 3; j++) {
        if (lines[j].includes('{')) {
          dayModeDepth = braceDepth;
          break;
        }
        if (lines[j].trim().length > 0 && !lines[j].includes('{')) break;
      }
    }
  }

  return dayModeLines;
}

// ============================================================
// SCANNING LOGIC
// ============================================================

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath);
  const lines = content.split('\n');
  const relPath = path.relative(process.cwd(), filePath);

  // Skip node_modules, dist, etc.
  if (relPath.includes('node_modules') || relPath.includes('dist')) return;

  // Skip website2 landing page - it has its own documented font-stack override
  // (Fustat for headings, Geist/Inter for body) per .claude/rules/design-system.md section L.
  // The main-app font rules (var(--font-body) resolves to JetBrains Mono) do not apply here.
  if (relPath.includes('pages/website2') || relPath.includes('website2.css')) return;

  // Determine app context
  const isResearchApp = relPath.includes('apps/research');
  const isTradingApp = relPath.includes('apps/trading');
  const isCssFile = ext === '.css';
  const isDayModeFile = relPath.includes('day-mode');

  // Build day-mode context map for CSS files
  const dayModeLines = isCssFile ? buildDayModeLineSet(lines) : new Set();

  lines.forEach((line, lineNum) => {
    const num = lineNum + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;
    // Skip empty lines
    if (trimmed.length === 0) return;

    const isInDayMode = dayModeLines.has(lineNum) || isDayModeFile
      || /day-mode|day_mode|\..*-day\b|\..*--day\b/.test(line)
      || /dayMode\s*[\?&|]/.test(line) || /isDayMode\s*[\?&|]/.test(line);

    // Check banned hex colors (never allowed, even in day mode)
    BANNED_HEX_COLORS.forEach(rule => {
      if (rule.pattern.test(line)) {
        // Exception: CSS variable definitions in index.css
        if (relPath.endsWith('index.css') && line.includes('--')) return;
        // Exception: SVG fill/stroke in JSX
        if ((line.includes('fill=') || line.includes('stroke=')) && ext === '.jsx') return;
        // Exception: inside day-mode blocks (some of these are used as day mode values)
        if (isInDayMode) return;

        VIOLATIONS.push({
          file: relPath, line: num, text: trimmed,
          rule: `Hardcoded color: ${line.match(rule.pattern)?.[0]}`,
          fix: rule.fix, severity: 'error',
        });
      }
      rule.pattern.lastIndex = 0;
    });

    // Check dark-only banned hex (OK in day mode, banned outside)
    if (!isInDayMode) {
      DARK_ONLY_BANNED_HEX.forEach(rule => {
        if (rule.pattern.test(line)) {
          if (relPath.endsWith('index.css') && line.includes('--')) return;
          if ((line.includes('fill=') || line.includes('stroke=')) && ext === '.jsx') return;
          // Exception: badge/pill colors that legitimately use white text on colored bg
          if (trimmed.includes('color: #ffffff') || trimmed.includes("color: '#ffffff'")) return;

          VIOLATIONS.push({
            file: relPath, line: num, text: trimmed,
            rule: `Hardcoded color outside day-mode: ${line.match(rule.pattern)?.[0]}`,
            fix: rule.fix, severity: 'error',
          });
        }
        rule.pattern.lastIndex = 0;
      });
    }

    // Check banned patterns
    BANNED_PATTERNS.forEach(rule => {
      if (rule.pattern.test(line)) {
        // Skip CSS-only rules for JSX files
        if (rule.cssOnly && !isCssFile) return;
        // Skip day-mode context for CSS rules
        if (rule.cssOnly && isInDayMode) return;
        // lucide-react is allowed in trading app and non-research apps
        if (rule.fix.includes('lucide') && !isResearchApp) return;
        // font-family in inline error handlers is OK (main.jsx fallback)
        if (rule.fix.includes('font-body') && line.includes('innerHTML')) return;

        VIOLATIONS.push({
          file: relPath, line: num, text: trimmed,
          rule: `Banned pattern: ${line.match(rule.pattern)?.[0]}`,
          fix: rule.fix, severity: 'error',
        });
      }
      rule.pattern.lastIndex = 0;
    });
  });

  // File-level checks for CSS files
  if (isCssFile && !relPath.endsWith('index.css')) {
    const hasCustomBg = /background\s*:/.test(content) || /background-color\s*:/.test(content);
    const hasDayMode = /\.app-day-mode|\.app\.app-day-mode|day-mode/.test(content);

    // Only flag files with substantial custom styling and no day mode counterparts
    if (hasCustomBg && !hasDayMode && !isDayModeFile && content.length > 300) {
      // Check if there's a separate day-mode CSS file for this component
      const baseName = path.basename(filePath, '.css');
      const dirName = path.dirname(filePath);
      const dayModeFile = path.join(dirName, `${baseName}.day-mode.css`);
      const hasSeparateDayMode = fs.existsSync(dayModeFile);

      if (!hasSeparateDayMode) {
        VIOLATIONS.push({
          file: relPath, line: 0, text: '(file-level check)',
          rule: 'Missing day mode styles',
          fix: 'Every CSS file with custom backgrounds MUST include .app-day-mode counterparts (inline or in a .day-mode.css file).',
          severity: 'warning',
        });
      }
    }
  }
}

// ============================================================
// MAIN
// ============================================================

const targetPath = process.argv[2] || '.';
let searchPaths;

if (targetPath === '.') {
  searchPaths = [
    'apps/research/src/**/*.{css,jsx,tsx}',
    'apps/trading/src/**/*.{css,jsx,tsx}',
  ];
} else if (targetPath.match(/\.(css|jsx|tsx)$/)) {
  searchPaths = [targetPath];
} else {
  searchPaths = [`${targetPath}/**/*.{css,jsx,tsx}`];
}

let allFiles = [];
for (const pattern of searchPaths) {
  const files = glob.sync(pattern, { ignore: ['**/node_modules/**', '**/dist/**'] });
  allFiles.push(...files);
}

allFiles = [...new Set(allFiles)];

console.log(`\n  SPECTRE DESIGN GUARDIAN`);
console.log(`  Scanning ${allFiles.length} files...\n`);

allFiles.forEach(scanFile);

if (VIOLATIONS.length === 0) {
  console.log('  No design violations found. The design law is respected.\n');
  process.exit(0);
} else {
  const errors = VIOLATIONS.filter(v => v.severity === 'error');
  const warnings = VIOLATIONS.filter(v => v.severity === 'warning');

  console.log(`  ${errors.length} errors, ${warnings.length} warnings\n`);

  // Group by file
  const byFile = {};
  VIOLATIONS.forEach(v => {
    if (!byFile[v.file]) byFile[v.file] = [];
    byFile[v.file].push(v);
  });

  Object.entries(byFile).forEach(([file, violations]) => {
    console.log(`  ${file}`);
    violations.forEach(v => {
      const icon = v.severity === 'error' ? 'ERROR' : 'WARN ';
      const lineInfo = v.line ? `:${v.line}` : '';
      console.log(`    ${icon}${lineInfo} ${v.rule}`);
      if (v.text !== '(file-level check)') {
        console.log(`          Code: ${v.text.substring(0, 120)}`);
      }
      console.log(`          Fix:  ${v.fix}`);
    });
    console.log('');
  });

  console.log(`  Total: ${errors.length} errors, ${warnings.length} warnings`);
  if (errors.length > 0) {
    console.log('  Fix all errors before committing.\n');
  }
  process.exit(errors.length > 0 ? 1 : 0);
}
