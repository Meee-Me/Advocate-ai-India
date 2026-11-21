// Builds the landing page (bilingual, Malayalam-only, English-only) for
// https://ai-advocate-india-landing.vercel.app from one data source.
// Run: node landing/build.mjs  (writes landing/public/{index.html, ml/index.html, en/index.html})
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'public');

// [Malayalam heading, English heading, Malayalam body, English body]
const FEATURES = [
  ['നിയമ ചാറ്റ്', 'Legal chat',
    'ഇന്ത്യൻ നിയമത്തെക്കുറിച്ചുള്ള ചോദ്യങ്ങൾക്ക് ഉത്തരം; വേണമെങ്കിൽ ഒരു കേസിന്റെ വിവരങ്ങൾ പശ്ചാത്തലമായി ഉപയോഗിക്കാം.',
    'Answers on Indian law, optionally using one of your cases as context.'],
  ['ഗവേഷണം', 'Research',
    'ഘടനയുള്ള റിസർച്ച് മെമ്മോ. ഓരോ അതോറിറ്റിയും "നിങ്ങളുടെ രേഖകളിൽ നിന്ന്" എന്നോ "AI ഓർമ്മ: പരിശോധിക്കുക" എന്നോ അടയാളപ്പെടുത്താനാണ് ഉദ്ദേശിക്കുന്നത്.',
    'Structured research memos, intended to label each authority as "from your materials" or "AI memory: verify".'],
  ['കരട് തയ്യാറാക്കൽ', 'Drafting',
    'നോട്ടീസ്, ഹർജി, സത്യവാങ്മൂലം, കരാർ. അറിയാത്ത വിവരങ്ങൾ ഒഴിവിടമായി വിടുക എന്നതാണ് ലക്ഷ്യം; മാറ്റങ്ങളുടെ പതിപ്പ് ചരിത്രവും.',
    'Notices, petitions, affidavits and agreements. The aim is for unknown facts to stay as placeholders rather than be invented; version history for changes.'],
  ['രേഖകളും OCR-ഉം', 'Documents and OCR',
    'PDF അപ്‌ലോഡ് ചെയ്ത് സംഗ്രഹം ലഭിക്കാനുള്ള സൗകര്യം. സ്കാൻ ചെയ്ത PDF-കൾ OCR ഉപയോഗിച്ച് വായിക്കാനും പദ്ധതിയുണ്ട്.',
    'Upload PDFs and get summaries. Reading scanned PDFs with OCR is also planned.'],
  ['കരാർ, വിധി വിശകലനം', 'Contract and judgment analysis',
    'അപകടസാധ്യതകൾ, ബാധ്യതകൾ, വിധിയുടെ കാരണങ്ങൾ, ഉദ്ധരിച്ച കേസുകൾ. ഉദ്ധരണികൾ രേഖയിലെ വാചകവുമായി ഒത്തുനോക്കാനും, കണ്ടെത്താത്തവ അടയാളപ്പെടുത്താനും ഉദ്ദേശിക്കുന്നു.',
    'Risks, obligations, ratio and obiter, cases cited. Quotes are meant to be compared with the document text, with any that cannot be found flagged.'],
  ['വിവർത്തനം', 'Translation',
    'ഇംഗ്ലീഷിനും മലയാളം ഉൾപ്പെടെ 12 ഇന്ത്യൻ ഭാഷകൾക്കും ഇടയിൽ, ഗ്ലോസറിയോടെ. സാക്ഷ്യപ്പെടുത്തിയ വിവർത്തനമല്ല.',
    'Between English and 12 Indian languages, Malayalam included, with a glossary. Not a certified translation.'],
  ['കേസുകൾ, ക്ലയന്റുകൾ, കുറിപ്പുകൾ', 'Cases, clients and notes',
    'ഓരോ അഭിഭാഷകനും സ്വന്തമായി സ്വകാര്യമായിരിക്കാൻ രൂപകൽപ്പന ചെയ്ത, പരസ്പരം ബന്ധിപ്പിച്ച രേഖകൾ.',
    'Linked records, designed to be private to each advocate.'],
  ['ഹിയറിംഗ് കലണ്ടർ', 'Hearing calendar',
    'മാസക്കാഴ്ച, ആപ്പിനുള്ളിലെ ഓർമ്മപ്പെടുത്തലുകൾ, ഫോൺ കലണ്ടറിലേക്ക് .ics എക്സ്പോർട്ട്.',
    'Month view, in-app reminders, and .ics export to your phone calendar.'],
  ['ഡാഷ്ബോർഡും പ്രൊഫൈലും', 'Dashboard and profile',
    'ബാർ കൗൺസിൽ വിവരങ്ങൾ, പ്രാക്ടീസ് മേഖലകൾ, കോടതികൾ, ഭാഷകൾ.',
    'Bar Council details, practice areas, courts and languages.'],
];

const SAFEGUARDS = [
  ['കെട്ടിച്ചമച്ച അതോറിറ്റികൾ കണ്ടെത്താൻ ശ്രമിക്കുന്നു', 'Aims to catch invented authorities',
    'നിങ്ങൾ നൽകിയ രേഖകളിൽ ഇല്ലാത്ത റിപ്പോർട്ടർ സൈറ്റേഷനുകൾ ഡിഫോൾട്ടായി നീക്കം ചെയ്യാനും, കേസ് പേരുകളും നിയമങ്ങളും "പരിശോധിച്ചിട്ടില്ല" എന്ന് അടയാളപ്പെടുത്താനുമാണ് ലക്ഷ്യം. എല്ലാ പിശകുകളും ഇത് കണ്ടെത്തണമെന്നില്ല.',
    'The aim is to remove, by default, reporter citations that are not in material you supplied, and to mark case names and Acts as unverified. It will not catch every error.'],
  ['ഉദ്ധരണി പരിശോധന', 'Quote checking',
    'വിശകലനത്തിലെ ഉദ്ധരണി രേഖയിൽ അക്ഷരംപ്രതി ഇല്ലെങ്കിൽ "കണ്ടെത്തിയില്ല" എന്ന് കാണിക്കാനാണ് ലക്ഷ്യം. ഇത് വാചക പൊരുത്തം മാത്രമാണ്; ഉദ്ധരണി ശരിയായി ഉപയോഗിച്ചു എന്നതിന്റെ തെളിവല്ല.',
    'The aim is to show a quote in an analysis as "not found" if it does not appear word for word in the document. This is a text match only, not proof that the quote is used correctly.'],
  ['ഓരോ അഭിഭാഷകന്റെയും ഡാറ്റ വേറിട്ട് സൂക്ഷിക്കുക (ലക്ഷ്യം)', 'Data kept separate per advocate (a goal)',
    'എല്ലാ രേഖകളും ഓരോ അഭിഭാഷകന്റെയും അക്കൗണ്ടിൽ മാത്രം ഒതുങ്ങുന്ന വിധത്തിലാണ് രൂപകൽപ്പന.',
    'Records are designed to be scoped to each advocate’s account.'],
  ['AI-യിലേക്ക് പോകുന്നത് വ്യക്തമായി', 'Clear about what goes to the AI',
    'നിങ്ങൾ വിശകലനം ചെയ്യുന്ന കേസ് വിവരങ്ങളും രേഖകളും AI ദാതാവിന് (Ollama Cloud) അയയ്ക്കും. ഓരോ അഭ്യർത്ഥനയ്ക്കും മുമ്പ് നിങ്ങളുടെ സമ്മതം ചോദിക്കുന്ന വിധത്തിലാണ് രൂപകൽപ്പന.',
    'Case text and documents you analyse would be sent to the AI provider (Ollama Cloud). The design asks for your confirmation before each request.'],
];

// [CSS class, [Malayalam status, English status], Malayalam text, English text]
const STEPS = [
  ['done', ['പൂർത്തിയായി', 'DONE'], 'ഈ വിവര പേജ്', 'This information page'],
  ['now', ['നടക്കുന്നു', 'IN PROGRESS'], 'നിർമ്മാണവും രൂപകൽപ്പനയും', 'Building and design'],
  ['', ['തുടങ്ങിയിട്ടില്ല', 'NOT STARTED'], 'സുരക്ഷാ, സ്വകാര്യതാ പരിശോധന', 'Security and privacy testing'],
  ['', ['തുടങ്ങിയിട്ടില്ല', 'NOT STARTED'], 'പൊതു ലോഞ്ച് (തീയതി നിശ്ചയിച്ചിട്ടില്ല)', 'Public launch (no date set)'],
];

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// mode: 'both' shows Malayalam first with an English line under it;
// 'ml' / 'en' show only that language.
function bilingual(ml, en, mode, tag = 'p', cls = '') {
  const c = cls ? ` class="${cls}"` : '';
  const mlLine = `<${tag}${c} lang="ml">${ml}</${tag}>`;
  const enC = cls ? ` class="${cls} en"` : ' class="en"';
  const enLine = `<${tag}${enC} lang="en">${en}</${tag}>`;
  if (mode === 'ml') return `<${tag}${c} lang="ml">${ml}</${tag}>`;
  if (mode === 'en') return `<${tag}${c} lang="en">${en}</${tag}>`;
  return mlLine + enLine;
}

// A short label. In the bilingual page each language is its own lang-tagged span, so screen readers switch voice.
function lab(ml, en, mode) {
  if (mode === 'ml') return ml;
  if (mode === 'en') return en;
  return `<span lang="ml">${ml}</span>&nbsp;·&nbsp;<span lang="en">${en}</span>`; // &nbsp;: flex containers (pill, switcher) trim plain spaces between spans
}

function renderCards(items, mode, withTag, tagLabel) {
  return items
    .map(([hm, he, bm, be]) => {
      const tagHtml = withTag ? `<span class="tag">${tagLabel}</span>` : '';
      return `<div class="card">${tagHtml}<h3>${lab(hm, he, mode)}</h3>${bilingual(bm, be, mode)}</div>`;
    })
    .join('');
}

function renderSteps(mode) {
  return STEPS.map(([cls, [sm, se], bm, be]) => {
    const status = lab(sm, se, mode);
    const body = lab(bm, be, mode);
    return `<li${cls ? ` class="${cls}"` : ''}><span class="st">${status}</span><br>${body}</li>`;
  }).join('');
}

function page(mode) {
  const lang = mode === 'en' ? 'en' : 'ml';
  const title = mode === 'en'
    ? 'AI Advocate India — AI assistance for advocates'
    : 'AI Advocate India — അഭിഭാഷകര്‍ക്കായുള്ള AI സഹായി';
  const desc = mode === 'en'
    ? 'Research, drafting, document analysis, case and hearing management for advocates in India — full application coming soon.'
    : 'ഗവേഷണം, കരട്, രേഖാ വിശകലനം, കേസ്, ഹിയരിംഗ് മാനേജ്‍മെന്റ് — പൂർണ്ണ ആപ്ലിക്കേഷൻ ഉടൻ വരുന്നു.';

  const navItems = [
    ['/', 'both', '<span lang="ml">മലയാളം</span>&nbsp;+&nbsp;<span lang="en">English</span>', 'ml'],
    ['/ml/', 'ml', 'മലയാളം', 'ml'],
    ['/en/', 'en', 'English', 'en'],
  ];
  const nav = navItems
    .map(([href, m, label, l]) => `<a href="${href}"${m === mode ? ' aria-current="page"' : ''} lang="${l}">${label}</a>`)
    .join('');

  const pillText = lab('ഉടൻ വരുന്നു', 'Coming soon', mode);
  const heroH1 = mode === 'en'
    ? '<h1 lang="en">AI assistance for advocates in India</h1>'
    : '<h1 lang="ml">അഭിഭാഷകർക്കായുള്ള AI സഹായി</h1>' + (mode === 'both' ? '<p class="en" lang="en">AI assistance for advocates in India</p>' : '');
  const heroLead = bilingual(
    'ഗവേഷണം, കരട് തയ്യാറാക്കൽ, രേഖാ വിശകലനം, കേസുകളും ഹിയറിംഗുകളും — ഒരിടത്ത്. ഇപ്പോൾ നിർമ്മാണത്തിലാണ്.',
    'Research, drafting, document analysis, cases and hearings in one place — currently being built.',
    mode, 'p', 'lead',
  );
  // A status notice, not a button: there is deliberately nothing here to click.
  const soon = '<div class="soon" role="status">'
    + (mode === 'en' ? '' : '<strong lang="ml">പൂർണ്ണ ആപ്ലിക്കേഷൻ ഉടൻ വരുന്നു</strong>')
    + (mode === 'ml' ? '' : `<${mode === 'en' ? 'strong' : 'span'} lang="en">Full application coming soon</${mode === 'en' ? 'strong' : 'span'}>`)
    + '</div>';

  const featuresHeading = lab('ആസൂത്രണം ചെയ്ത സവിശേഷതകൾ', 'Planned capabilities', mode);
  const featuresIntro = bilingual('ഇവ നിർമ്മാണത്തിലോ ആസൂത്രണത്തിലോ ഉള്ള സവിശേഷതകളാണ്. ഇപ്പോൾ ഒന്നും ഉപയോഗിക്കാൻ ലഭ്യമല്ല.', 'These capabilities are being built or planned. None of them is available to use yet.', mode);
  const plannedTag = lab('ആസൂത്രണം', 'Planned', mode);

  const safeguardsHeading = lab('സുരക്ഷാ സംവിധാനങ്ങൾ', 'Safeguards', mode);
  const safeguardsIntro = bilingual('AI തെറ്റുകൾ വരുത്താം. അതുകൊണ്ട് ഈ പരിശോധനകൾ രൂപകൽപ്പനയുടെ ഭാഗമാണ്. ഇവ ഇതുവരെ സ്വതന്ത്രമായി പരിശോധിച്ച് ഉറപ്പാക്കിയിട്ടില്ല.', 'AI can be wrong, so these checks are part of the design. They have not yet been independently verified.', mode);
  const noteMl = '<span lang="ml"><strong>ക്ലയന്റ് വിവരങ്ങൾ ഇപ്പോൾ നൽകരുത്.</strong> ഈ പേജിൽ ഫോമുകളോ സൈൻ-ഇൻ സൗകര്യമോ ഇല്ല.</span>';
  const noteEn = '<span lang="en"><strong>Please do not share client information yet.</strong> This page has no forms and no sign-in.</span>';
  const note = mode === 'en' ? noteEn : mode === 'ml' ? noteMl : `${noteMl}<br>${noteEn}`;

  const statusHeading = lab('ലോഞ്ച് നില', 'Launch status', mode);
  const afterSteps = bilingual(
    'സുരക്ഷയും സ്വകാര്യതയും പരിശോധിച്ച ശേഷം മാത്രമേ ആപ്ലിക്കേഷൻ പൊതുജനങ്ങൾക്കായി തുറക്കൂ. തീയതി ഇതുവരെ നിശ്ചയിച്ചിട്ടില്ല.',
    'The application will open to the public only after security and privacy checks are passed. No date has been set.',
    mode,
  );

  const footerNote = bilingual(
    'AI Advocate India ഒരു ജോലി സഹായി മാത്രമാണ്; നിയമോപദേശമല്ല. AI നൽകുന്നതെല്ലാം ഔദ്യോഗിക ഉറവിടങ്ങളിൽ അഭിഭാഷകൻ പരിശോധിച്ച് ഉറപ്പാക്കണം.',
    'AI Advocate India is a work assistant, not legal advice. Verify everything AI produces against an official or licensed source.',
    mode,
  );

  return `<!DOCTYPE html>
<html lang="${lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#16264a">
<meta property="og:title" content="AI Advocate India">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<a class="skip" href="#main">${mode === 'en' ? 'Skip to content' : 'ഉള്ളടക്കത്തിലേക്ക്'}</a>
<header>
 <div class="wrap">
  <div class="brand"><img src="/favicon.svg" alt="" width="36" height="36"><span lang="en">AI Advocate India</span></div>
  <span class="pill">${pillText}</span>
 </div>
 <div class="wrap"><nav class="lang" aria-label="Language / ഭാഷ">${nav}</nav></div>
</header>
<main id="main">
 <div class="hero"><div class="wrap">
  ${heroH1}
  ${heroLead}
  ${soon}
 </div></div>
 <section class="alt" id="features"><div class="wrap">
  <h2>${featuresHeading}</h2>
  ${featuresIntro}
  <div class="grid three">${renderCards(FEATURES, mode, true, plannedTag)}</div>
 </div></section>
 <section id="safeguards"><div class="wrap">
  <h2>${safeguardsHeading}</h2>
  ${safeguardsIntro}
  <div class="grid">${renderCards(SAFEGUARDS, mode, false)}</div>
  <div class="note">${note}</div>
 </div></section>
 <section class="alt" id="status"><div class="wrap">
  <h2>${statusHeading}</h2>
  <ol class="steps">${renderSteps(mode)}</ol>
  ${afterSteps}
 </div></section>
</main>
<footer><div class="wrap">
 ${footerNote}
</div></footer>
</body></html>
`;
}

const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#16264a"/><path d="M32 12v34M18 20h28M18 20l-8 16h16zM46 20l-8 16h16zM22 50h20" stroke="#d9b56a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>\n';

const STYLES = `:root{--navy:#16264a;--navy-soft:#24376a;--brass:#a97c2c;--brass-soft:#f4ead2;--paper:#faf7f1;--card:#fff;--line:#e3dcca;--muted:#586178;--ink:#0f1b33}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--paper);color:var(--ink);line-height:1.65;font-size:1rem;
 font-family:"Noto Sans Malayalam","Malayalam Sangam MN",Kartika,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
 padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}
h1,h2,h3{font-family:"Noto Serif Malayalam","Noto Sans Malayalam","Malayalam Sangam MN",Georgia,"Times New Roman",serif;line-height:1.35;margin:0 0 .5rem;color:var(--navy)}
p{margin:0 0 .6rem}
.wrap{max-width:62rem;margin:0 auto;padding:0 1rem}
.en{color:var(--muted);font-size:.95em;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:var(--navy);color:#fff;padding-top:env(safe-area-inset-top)}
header .wrap{display:flex;align-items:center;justify-content:space-between;gap:.75rem;min-height:3.5rem;flex-wrap:wrap;padding-top:.4rem;padding-bottom:.4rem}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:700;font-family:Georgia,"Times New Roman",serif;font-size:1.1rem}
.brand img{width:2.25rem;height:2.25rem}
.pill{display:inline-flex;align-items:center;min-height:44px;background:var(--brass-soft);color:var(--navy);border-radius:999px;padding:.3rem .9rem;font-size:.85rem;font-weight:700;text-decoration:none}
.hero{background:linear-gradient(160deg,var(--navy),var(--navy-soft));color:#fff;padding:2.5rem 0 3rem}
.hero h1{color:#fff;font-size:clamp(1.75rem,6vw,2.75rem)}
.hero .en{color:#d6dcec;font-size:1.05rem}
.hero .lead{font-size:1.1rem;margin-top:1rem;color:#fff}
.hero .lead.en{color:#d6dcec}
.soon{display:inline-block;margin-top:1.25rem;padding:.8rem 1.1rem;border:2px solid #d9b56a;border-radius:.75rem;background:rgba(217,181,106,.12)}
.soon strong{display:block;color:#f4ead2;font-size:1.15rem}
.soon span{color:#d6dcec;font-size:.9rem}
section{padding:2.25rem 0}
section h2{font-size:clamp(1.4rem,4.5vw,1.9rem)}
.grid{display:grid;gap:1rem;grid-template-columns:1fr;margin-top:1.25rem}
@media (min-width:40rem){.grid{grid-template-columns:repeat(2,1fr)}}
@media (min-width:62rem){.grid.three{grid-template-columns:repeat(3,1fr)}}
.card{background:var(--card);border:1px solid var(--line);border-radius:.9rem;padding:1.1rem}
.card h3{font-size:1.1rem}
.tag{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#6b4e12;background:var(--brass-soft);border-radius:999px;padding:.1rem .6rem;margin-bottom:.5rem;font-family:system-ui,sans-serif}
.alt{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
ol.steps{list-style:none;margin:1.25rem 0 0;padding:0;display:grid;gap:.75rem}
ol.steps li{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:.6rem;padding:.8rem 1rem}
ol.steps li.done{border-left-color:#2f7d4f}
ol.steps li.now{border-left-color:var(--brass)}
.st{font-size:.8rem;font-weight:700;font-family:system-ui,sans-serif;color:var(--muted)}
.note{border:1px dashed var(--brass);background:var(--brass-soft);border-radius:.75rem;padding:1rem;margin-top:1.25rem}
footer{background:var(--navy);color:#d6dcec;padding:1.75rem 0 calc(1.75rem + env(safe-area-inset-bottom));font-size:.9rem}
footer p{margin-bottom:.5rem}
footer a{color:#f4ead2;font-weight:600}
a{color:inherit}
a:focus-visible{outline:3px solid #d9b56a;outline-offset:2px}
.skip{position:absolute;left:-999px}
.skip:focus{left:.5rem;top:.5rem;background:#fff;color:var(--navy);padding:.5rem;z-index:9}
.lang{display:flex;gap:.5rem;flex-wrap:wrap;padding-bottom:.6rem}
.lang a{display:inline-flex;align-items:center;min-height:44px;padding:0 .9rem;border:1px solid rgba(255,255,255,.35);border-radius:999px;color:#fff;text-decoration:none;font-size:.9rem}
.lang a[aria-current=page]{background:#f4ead2;color:var(--navy);border-color:#f4ead2;font-weight:700}
`;

for (const [file, mode] of [['index.html', 'both'], ['ml/index.html', 'ml'], ['en/index.html', 'en']]) {
  const path = join(OUT, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, page(mode));
}
writeFileSync(join(OUT, 'favicon.svg'), FAVICON);
writeFileSync(join(OUT, 'styles.css'), STYLES);
console.log('Built landing pages in', OUT);
