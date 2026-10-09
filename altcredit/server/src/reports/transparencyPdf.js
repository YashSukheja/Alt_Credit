const PDFDocument = require('pdfkit');

// Drawing ONLY: takes the report data object and writes a PDF to `stream`
// (an HTTP response or a file). No database calls in here.

// Colours used for the risk bands (same names the engine returns)
const BAND_COLORS = {
  green: '#1e8e3e', lightgreen: '#7cb342', yellow: '#f9a825', orange: '#ef6c00', red: '#c62828',
};
const GREY = '#5f6368';
const LIGHT = '#e8eaed';
const DARK = '#202124';

// NOTE: the built-in PDF fonts (Helvetica) have no "₹" glyph, so we write "Rs".
const money = (v) => `Rs ${Number(v).toLocaleString('en-IN')}`;

function renderTransparencyPdf(data, stream) {
  // bufferPages lets us go back at the end and add "Page X of Y" footers
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true,
    info: { Title: `AltCredit Transparency Report ${data.report_id}`, Author: 'AltCredit' } });
  doc.pipe(stream);

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bandColor = BAND_COLORS[data.color] || GREY;

  // Small helper: section title with a thin line under it
  const section = (title) => {
    if (doc.y > doc.page.height - 150) doc.addPage(); // don't start a section at the very bottom
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK).text(title, left);
    doc.moveTo(left, doc.y + 2).lineTo(left + width, doc.y + 2).strokeColor(LIGHT).lineWidth(1).stroke();
    doc.moveDown(0.6);
  };

  // ---------- 1. Header ----------
  doc.font('Helvetica-Bold').fontSize(20).fillColor(DARK).text('AltCredit Transparency Report', left, 50);
  doc.font('Helvetica').fontSize(9).fillColor(GREY)
    .text(`Report ${data.report_id}  |  Generated ${new Date(data.generated_at).toUTCString()}  |  Rules ${data.rule_version}`);

  // ---------- 2. Score card: coloured box with score, band and decision ----------
  const boxY = doc.y + 12;
  doc.roundedRect(left, boxY, width, 90, 8).fillColor(bandColor).fill();
  doc.fillColor('white').font('Helvetica-Bold').fontSize(40).text(String(data.score), left + 20, boxY + 18, { width: 140 });
  doc.font('Helvetica').fontSize(10).text('out of 1000', left + 22, boxY + 62);
  doc.font('Helvetica-Bold').fontSize(16).text(data.risk_band, left + 170, boxY + 20, { width: width - 190 });
  doc.font('Helvetica-Bold').fontSize(12).text(`Decision: ${data.decision.outcome}`, left + 170, boxY + 44, { width: width - 190 });
  doc.font('Helvetica').fontSize(10).text(data.decision.summary, left + 170, boxY + 62, { width: width - 190 });
  doc.y = boxY + 100;

  // ---------- 3. Applicant (this is the user's OWN report, so identity is shown) ----------
  section('Applicant');
  const a = data.applicant;
  doc.font('Helvetica').fontSize(10).fillColor(DARK)
    .text(`User ID: ${a.user_id}     Age: ${a.age}     Employment: ${a.employment_status}`)
    .text(`Education: ${a.education_level}     City tier: ${a.city_tier}     Monthly income: ${money(a.monthly_income)}`);

  // ---------- 4. Score components as horizontal bars ----------
  section('Score components');
  Object.entries(data.components).forEach(([name, c]) => {
    const y = doc.y;
    const barX = left + 110;
    const barW = width - 200;
    const share = c.max > 0 ? Math.max(0, c.points) / c.max : 0;
    doc.font('Helvetica').fontSize(10).fillColor(DARK).text(name, left, y + 2, { width: 100 });
    doc.rect(barX, y, barW, 12).fillColor(LIGHT).fill();                 // empty track
    doc.rect(barX, y, barW * Math.min(1, share), 12).fillColor(bandColor).fill(); // filled part
    doc.fillColor(DARK).text(`${c.points} / ${c.max}`, barX + barW + 10, y + 2);
    doc.y = y + 20;
  });

  // ---------- 5. Factor-by-factor table: WHY the score is what it is ----------
  section('How your score was calculated');
  const col = { code: left, factor: left + 32, points: left + 220, reason: left + 285 };
  const header = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY)
    .text('#', col.code, header).text('Factor', col.factor, header)
    .text('Points', col.points, header).text('Reason', col.reason, header);
  doc.moveDown(0.4);

  data.breakdown.forEach((f, i) => {
    if (doc.y > doc.page.height - 90) doc.addPage();
    const y = doc.y;
    const reasonText = f.reason.replace(/: [-+]?\d+(\/\d+)? points$/, ''); // points already in their own column
    const rowH = Math.max(doc.heightOfString(reasonText, { width: width - 285 }), 12) + 6;
    if (i % 2 === 0) doc.rect(left - 4, y - 3, width + 8, rowH).fillColor('#f8f9fa').fill(); // zebra rows
    const pts = f.max > 0 ? `${f.points}/${f.max}` : String(f.points);
    doc.font('Helvetica').fontSize(9).fillColor(DARK)
      .text(f.code, col.code, y, { width: 30 })
      .text(f.label, col.factor, y, { width: 185 })
      .fillColor(f.points < 0 ? BAND_COLORS.red : DARK).text(pts, col.points, y, { width: 60 })
      .fillColor(f.missing ? BAND_COLORS.orange : DARK).text(reasonText, col.reason, y, { width: width - 285 });
    doc.y = y + rowH;
  });
  doc.font('Helvetica').fontSize(8).fillColor(GREY)
    .text(`Raw points: ${data.raw_points}. The final score is capped to the 0-1000 range.`, left, doc.y + 4);

  // ---------- 6. Strengths and what to improve ----------
  section('Your strengths');
  data.top_positive.forEach((f) => {
    doc.font('Helvetica').fontSize(10).fillColor(DARK).text(`+  ${f.label}: ${f.points}/${f.max}`, { indent: 6 });
  });

  section('What would improve your score');
  const tips = data.top_negative.filter((f) => f.tip);
  if (tips.length === 0) doc.font('Helvetica').fontSize(10).text('Your score is already at the top of every factor.');
  tips.forEach((f) => {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(f.label, { indent: 6, continued: true })
      .font('Helvetica').text(`  -  ${f.tip}`);
  });

  // ---------- 7. Products ----------
  section('Products');
  data.products.eligible.forEach((p) => {
    doc.font('Helvetica').fontSize(10).fillColor(BAND_COLORS.green)
      .text(`Eligible   ${p.product_name} (${p.type}, ${p.interest_rate}% ${p.rate_unit})`, { indent: 6 });
  });
  data.products.locked.forEach((p) => {
    doc.font('Helvetica').fontSize(10).fillColor(GREY)
      .text(`Locked     ${p.product_name}: needs ${p.min_score}, you are ${p.points_away} points away`, { indent: 6 });
  });

  // ---------- 8. Disclaimer (problem statement guardrail: not a legal decision) ----------
  section('Important');
  doc.font('Helvetica').fontSize(8).fillColor(GREY).text(data.disclaimer, { width });

  // ---------- 9. Footer on every page ----------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // The footer sits BELOW the bottom margin. Without this, pdfkit thinks the page
    // is full and adds a new blank page for every footer. Lift the margin, draw, restore.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(GREY).text(
      `AltCredit  |  ${data.report_id}  |  Page ${i + 1} of ${range.count}`,
      left, doc.page.height - 35, { width, align: 'center', lineBreak: false },
    );
    doc.page.margins.bottom = bottom;
  }

  doc.end(); // finishes the PDF and closes the stream
}

module.exports = { renderTransparencyPdf };