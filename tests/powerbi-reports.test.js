const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('seçilen dört Power BI raporu rapor sekmelerine eklenir', () => {
  const reports = ['Takip Raporu', 'Alan Doluluk Oranları', 'İştirak Şirket Yüzdelik', 'Arıza Sayıları'];
  for (const report of reports) assert.match(html, new RegExp(`data-report-tab="[^"]+"[^>]*>${report}<`));
  const reportView = html.slice(html.indexOf('id="reportsView"'), html.indexOf('</section>\n    </main>'));
  assert.doesNotMatch(reportView, /Beklemedeki İşler|Başlanmamış İşler/);
});

test('raporlar canlı veriden hesaplanır, filtrelenir ve aktif sekme dışa aktarılır', () => {
  for (const fn of ['reportLaborRows', 'completenessFieldRows', 'renderAffiliateReport', 'renderFailureReport', 'exportReport']) {
    assert.match(app, new RegExp(`function ${fn}\\(`));
  }
  assert.match(app, /activeReportSection==='tracking'/);
  assert.match(app, /activeReportSection==='completeness'/);
  assert.match(app, /activeReportSection==='affiliate'/);
  assert.match(app, /name='ariza-sayilari'/);
  assert.match(css, /\.report-tabs\{/);
  assert.match(css, /@media\(max-width:760px\).*\.report-tabs/s);
});
