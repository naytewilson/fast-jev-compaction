// run-report.ts — explicit report driver: awaits report() to settle and
// surfaces errors. `tsx -e` cannot TLA (CJS); the battery.ts CLI path hit an
// unsettled-await exit for the mercury outdir, so this forces the promise.
import { report } from './report.js';

const [outdir, compareOutdir] = process.argv.slice(2);
if (!outdir) {
  console.error('usage: tsx tools/abi-battery/run-report.ts <outdir> [compareOutdir]');
  process.exit(2);
}
const timer = setTimeout(() => {
  console.error('TIMEOUT 300s — report still pending');
  process.exit(3);
}, 300_000);
try {
  await report(outdir, compareOutdir || undefined);
  clearTimeout(timer);
  console.log('REPORT DONE');
} catch (error) {
  clearTimeout(timer);
  console.error('REPORT FAILED:', error);
  process.exit(1);
}
