#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolve directory name for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const stateDir = path.join(repoRoot, '.agent', 'state');
const assessmentPath = path.join(stateDir, 'assessment.json');
const statusJsonPath = path.join(stateDir, 'repo-status.json');
const statusMdPath = path.join(stateDir, 'repo-status.md');

// Ensure state directory exists
if (!fs.existsSync(stateDir)) {
  fs.mkdirSync(stateDir, { recursive: true });
}

// Help message
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: node scripts/generate-repo-status.mjs [options]

Options:
  -h, --help      Show this help message
  --offline       Force offline mode (skip GitHub CLI queries)
`);
  process.exit(0);
}

const forceOffline = process.argv.includes('--offline');

// Helper for safe execution
function runCommand(cmd, args) {
  if (cmd === 'gh' && forceOffline) {
    return null;
  }
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    return null;
  }
}

// Route extraction helper
export function extractRoute(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Next.js App Router: app/.../page.tsx or src/app/.../page.tsx
  const appMatch = normalizedPath.match(/^(?:src\/)?app\/(.+)\/page\.[jt]sx?$/);
  if (appMatch) {
    let route = '/' + appMatch[1];
    route = route.replace(/\/\([^)]+\)/g, '');
    route = route.replace(/\/+/g, '/');
    return route || '/';
  }
  const rootAppMatch = normalizedPath.match(/^(?:src\/)?app\/page\.[jt]sx?$/);
  if (rootAppMatch) {
    return '/';
  }

  // Next.js Pages Router: pages/... or src/pages/...
  const pagesMatch = normalizedPath.match(/^(?:src\/)?pages\/(.+)\.[jt]sx?$/);
  if (pagesMatch) {
    let route = '/' + pagesMatch[1];
    if (route.endsWith('/index')) {
      route = route.slice(0, -6);
    }
    route = route.replace(/\/+/g, '/');
    return route || '/';
  }

  // Generic routes folder: routes/... or src/routes/...
  const genericMatch = normalizedPath.match(/^(?:src\/)?routes\/(.+)\.[jt]s$/);
  if (genericMatch) {
    let route = '/' + genericMatch[1];
    if (route.endsWith('/index')) {
      route = route.slice(0, -6);
    }
    route = route.replace(/\/+/g, '/');
    return route || '/';
  }

  return null;
}

function getChangedRoutes() {
  const output = runCommand('git', ['status', '--porcelain']);
  if (!output) return [];
  const files = output.split('\n').filter(Boolean).map(line => {
    // Line format is "XY path" or "XY path -> newpath"
    const pathPart = line.substring(3).trim();
    if (pathPart.includes(' -> ')) {
      return pathPart.split(' -> ')[1].trim();
    }
    return pathPart;
  });
  const routes = new Set();
  for (const file of files) {
    const route = extractRoute(file);
    if (route) {
      routes.add(route);
    }
  }
  return Array.from(routes);
}

function getRecentCommits() {
  const output = runCommand('git', ['log', '-n', '5', '--pretty=format:%H|||%an|||%cI|||%s']);
  if (!output) return [];
  return output.split('\n').filter(Boolean).map(line => {
    const [sha, author, date, message] = line.split('|||');
    return { sha, author, date, message };
  });
}

function getOpenPrs() {
  const output = runCommand('gh', ['pr', 'list', '--limit', '10', '--json', 'number,title,author,url,state']);
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch {
    return [];
  }
}

function getOpenIssues() {
  const output = runCommand('gh', ['issue', 'list', '--limit', '10', '--json', 'number,title,author,url,state']);
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch {
    return [];
  }
}

function getCiStatus(branch) {
  const output = runCommand('gh', ['run', 'list', '--limit', '5', '--json', 'name,conclusion,status,headBranch,headSha']);
  if (!output) return 'unknown (offline/error)';
  try {
    const runs = JSON.parse(output);
    if (!Array.isArray(runs) || runs.length === 0) return 'unknown (no runs)';
    // Find run for current branch
    const branchRun = runs.find(r => r.headBranch === branch);
    if (branchRun) {
      return `${branchRun.status}${branchRun.conclusion ? ` (${branchRun.conclusion})` : ''}`;
    }
    // Fallback to the latest run of any branch
    const latestRun = runs[0];
    return `${latestRun.status}${latestRun.conclusion ? ` (${latestRun.conclusion})` : ''}`;
  } catch {
    return 'unknown (parse error)';
  }
}

// Load assessment
let assessment = { verified: [], uncertain: [], next_action: '' };
if (fs.existsSync(assessmentPath)) {
  try {
    assessment = JSON.parse(fs.readFileSync(assessmentPath, 'utf8'));
  } catch (error) {
    console.error('Failed to parse assessment.json:', error.message);
  }
} else {
  fs.writeFileSync(assessmentPath, JSON.stringify(assessment, null, 2), 'utf8');
}

// Fetch states
const branch = runCommand('git', ['branch', '--show-current']) || runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown';
const headSha = runCommand('git', ['rev-parse', 'HEAD']) || 'unknown';
const ciStatus = getCiStatus(branch);
const changedRoutes = getChangedRoutes();
const recentCommits = getRecentCommits();
const openPrs = getOpenPrs();
const openIssues = getOpenIssues();

const verified = assessment.verified || [];
const uncertain = assessment.uncertain || [];
const nextAction = assessment.next_action || '';

const statusData = {
  branch,
  head_sha: headSha,
  ci_status: ciStatus,
  changed_routes: changedRoutes,
  open_prs: openPrs,
  open_issues: openIssues,
  recent_commits: recentCommits,
  verified,
  uncertain,
  next_action: nextAction
};

// Write JSON
fs.writeFileSync(statusJsonPath, JSON.stringify(statusData, null, 2), 'utf8');

// Determine CI Status label
let ciStatusText = '[Unknown]';
if (ciStatus.includes('success')) {
  ciStatusText = '[Success]';
} else if (ciStatus.includes('failure')) {
  ciStatusText = '[Failure]';
} else if (ciStatus.includes('in_progress') || ciStatus.includes('queued')) {
  ciStatusText = '[Running]';
}

const markdownContent = `# Repository Status Snapshot

*Generated on: ${new Date().toISOString()}*

## Git & CI State
- **Branch:** \`${branch}\`
- **HEAD SHA:** \`${headSha}\`
- **CI/CD Status:** ${ciStatusText} \`${ciStatus}\`

## Changed Routes
${changedRoutes.length > 0 ? changedRoutes.map(r => `- \`${r}\``).join('\n') : '*No changed routes detected.*'}

## Git History & Activity
### Recent Commits (Last 5)
${recentCommits.length > 0 ? recentCommits.map(c => `- \`${c.sha.slice(0, 7)}\` - ${c.message} (${c.author}, ${c.date})`).join('\n') : '*No recent commits found.*'}

### Pull Requests (Open)
${openPrs.length > 0 ? openPrs.map(p => `- [#${p.number}](${p.url}) - ${p.title} (by \`${p.author?.login || p.author || 'unknown'}\`)`).join('\n') : '*No open pull requests.*'}

### Issues (Open)
${openIssues.length > 0 ? openIssues.map(i => `- [#${i.number}](${i.url}) - ${i.title}`).join('\n') : '*No open issues.*'}

## Assessment & Judgment
> [!NOTE]
> These fields are persistent and evidence-backed from \`.agent/state/assessment.json\`.

### Verified Facts
${verified.length > 0 ? verified.map(f => `- ${f}`).join('\n') : '*No verified facts.*'}

### Uncertainties / Open Questions
${uncertain.length > 0 ? uncertain.map(u => `- ${u}`).join('\n') : '*No uncertainties.*'}

### Next Recommended Action
${nextAction ? `> ${nextAction}` : '*No next recommended action.*'}
`;

// Write MD
fs.writeFileSync(statusMdPath, markdownContent, 'utf8');

console.log('Successfully generated repository status artifacts!');
