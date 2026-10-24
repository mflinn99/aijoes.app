/**
 * Re-check the deployed SaleSonic personas Repl against the source document.
 *
 * The narrative requirement does not stop at the dataset — it has to survive
 * into the running app. This script pulls the rendered pages (or reads dumps
 * saved from a browser) and reports exactly which sentences from the document
 * are not on screen.
 *
 *   npm run salesonic:check -- --url https://3-salesonic-personas.replit.app \
 *       --path / --path /salesman --path /manager --path /director
 *   npm run salesonic:check -- --file dumps/salesman.html --file dumps/manager.html
 *
 * Client-rendered pages will under-report over plain HTTP: save the rendered
 * DOM (or a text copy of each screen) and pass it with --file instead.
 */

import { readFileSync } from 'node:fs';
import { checkCoverage, formatReport } from '../src/lib/salesonic/narrative-coverage';

interface Args {
  url?: string;
  paths: string[];
  files: string[];
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { paths: [], files: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--url' && value) { args.url = value; i += 1; }
    else if (flag === '--path' && value) { args.paths.push(value); i += 1; }
    else if (flag === '--file' && value) { args.files.push(value); i += 1; }
    else if (flag === '--json') { args.json = true; }
  }
  if (args.url && args.paths.length === 0) args.paths.push('/');
  return args;
}

/** Strip markup so a phrase split across tags still matches the visible text. */
function textFromHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&pound;/gi, '£')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z]+;/gi, ' ');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sources: string[] = [];
  const fetched: string[] = [];

  for (const file of args.files) {
    sources.push(textFromHtml(readFileSync(file, 'utf-8')));
    fetched.push(file);
  }

  if (args.url) {
    for (const path of args.paths) {
      const target = new URL(path, args.url).toString();
      try {
        const res = await fetch(target);
        if (!res.ok) {
          console.error(`  ! ${target} returned HTTP ${res.status}`);
          continue;
        }
        sources.push(textFromHtml(await res.text()));
        fetched.push(target);
      } catch (error) {
        console.error(`  ! ${target} could not be fetched: ${(error as Error).message}`);
      }
    }
  }

  if (sources.length === 0) {
    console.error('Nothing to check. Pass --url (with --path) and/or --file.');
    process.exitCode = 2;
    return;
  }

  const report = checkCoverage(sources.join('\n'));
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report, `Deployed SaleSonic app — checked ${fetched.join(', ')}`));
  }
  process.exitCode = report.missing.length === 0 ? 0 : 1;
}

void main();
