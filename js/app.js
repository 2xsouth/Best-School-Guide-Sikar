// ============================================================
//  Best School Guide Sikar — main app logic
//  Reads schools from data/schools.js (window.SCHOOLS)
//  Reads PUBLISHED blogs from Supabase (or demo fallback)
//  No admin panel here — blog approval happens in Telegram.
// ============================================================

const SCHOOLS = window.SCHOOLS || [];

// Supabase client (only if configured)
let sb = null;
if (window.BSG_CONFIG && window.BSG_CONFIG.ENABLED && window.supabase) {
  sb = window.supabase.createClient(
    window.BSG_CONFIG.SUPABASE_URL,
    window.BSG_CONFIG.SUPABASE_ANON_KEY
  );
}

// ---------- demo blogs (shown only if Supabase not configured) ----------
let BLOGS = [
  {
    id: 1, img: null, title: "How to choose the right school in Sikar", cat: "Admissions", author: "Editorial Team", date: "Feb 2026", hue: 158,
    body: "Choosing a school is one of the biggest decisions a parent makes, and in a city like Sikar with dozens of options, it can feel overwhelming. Start with the practical basics: which board fits your child's long-term goals, how far the school is from home, and what the real all-in cost looks like once transport and extras are added.\nVisit in person before you decide. A brochure can't tell you whether classrooms are actually used well, whether children look happy, or how staff respond to questions.\nFinally, talk to current parents. Google Maps reviews are a good starting signal, but a five-minute conversation at the school gate often tells you more than any rating."
  },
  {
    id: 2, img: null, title: "CBSE vs RBSE vs ICSE: what fits your child", cat: "Boards", author: "Editorial Team", date: "Jan 2026", hue: 24,
    body: "Sikar offers schools across CBSE, RBSE and ICSE, and each suits a slightly different path. CBSE is the national standard, widely chosen by families aiming for JEE, NEET and other competitive exams.\nRBSE, the Rajasthan state board, is strong for students who plan to stay within the state system, often at a lower fee. ICSE tends to go deeper on English and project work.\nThere is no single best board — only the best fit for your child's strengths and goals."
  },
  {
    id: 3, img: null, title: "Understanding school fees in Sikar", cat: "Fees", author: "Editorial Team", date: "Jan 2026", hue: 222,
    body: "Advertised tuition is rarely the full story. When budgeting for a Sikar school, add transport, admission and registration charges, uniforms, books, activity fees and — for boarding schools — hostel and mess costs.\nAsk for a written fee structure that lists every head, and check whether fees are quoted per term or per year.\nMany Sikar schools offer scholarships based on merit or need. It's always worth asking."
  }
];

// ---------- tiny helpers ----------
function esc(t) { return (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Allowed link domains for blog bodies. Only <a> tags to these exact hosts
// survive; everything else is escaped. This lets the auto-blogs contain real
// school backlinks without opening an HTML-injection hole.
const ALLOWED_LINK_HOSTS = [
  "eurointernationalschool.in", "pcpsikar.com", "princesainikschool.com",
  "keshwanandschool.com", "www.keshwanandschool.com", "floretoworldschool.com",
  "mhsworldschool.org", "www.mhsworldschool.org", "princecbse.com",
  "princeschoolsikar.com", "princelotusvalley.com", "tagoreedu.in",
  "daffodilsworldschool.com", "narayanaschools.in", "www.narayanaschools.in", "vps.ac.in"
];
// Escapes text but re-permits ONLY safe <a href="https://allowed-host...">label</a>.
// Escapes text but re-permits ONLY safe <a href="https://allowed-host...">label</a>.
// Escapes text but re-permits ONLY safe <a href="https://allowed-host...">label</a>.
function safeBody(text) {
  const safe = esc(text || '');

  // Uses \s+ instead of \b for a guaranteed boundary match
  return safe.replace(/&lt;a\s+.*?href=["']([^"']+)["'].*?&gt;([\s\S]*?)&lt;\/a&gt;/gi,
    function (m, url, label) {
      try {
        // Revert any &amp; back to & so the URL parses correctly
        const cleanUrl = url.replace(/&amp;/g, '&');
        const u = new URL(cleanUrl);

        // Strip 'www.' for the whitelist check
        const host = u.host.replace(/^www\./, '');

        // ALLOWED_LINK_HOSTS MUST be defined above this function
        if (u.protocol === 'https:' && ALLOWED_LINK_HOSTS.map(h => h.replace(/^www\./, '')).indexOf(host) > -1) {
          return '<a href="' + u.href + '" target="_blank" rel="noopener" style="color:var(--brand);font-weight:600">' + label + '</a>';
        }
      } catch (e) { }
      return label; // not allowed -> plain label text, no link
    });
}
// Plain-text (no tags at all) for card previews.
function stripTags(text) { return esc((text || '').replace(/<[^>]*>/g, '')); }
function photoBg(hue) { return "background:linear-gradient(135deg,hsl(" + hue + ",42%,42%),hsl(" + ((hue + 40) % 360) + ",38%,30%));"; }
function stars(r) { let f = Math.round(r); return "\u2605\u2605\u2605\u2605\u2605".slice(0, f) + "\u2606\u2606\u2606\u2606\u2606".slice(0, 5 - f); }
function shortName(s) { return s.id === 'euro' ? 'Euro' : s.name.split(' ').slice(0, 2).join(' '); }
function blogBg(b) {
  if (b.img) return "background-image:linear-gradient(rgba(10,30,25,.12),rgba(10,30,25,.34)),url('" + b.img + "');background-size:cover;background-position:center;";
  return photoBg(b.hue || 158);
}
function cardPhoto(s) {
  if (s.img) return "background-image:linear-gradient(rgba(10,30,25,.12),rgba(10,30,25,.30)),url('" + s.img + "');background-size:cover;background-position:center;";
  return photoBg(s.hue);
}
const BOARD_LABEL = { cbse: "CBSE", rbse: "RBSE", icse: "ICSE", english: "English Medium", prefoundation: "Pre-Foundation" };
function badgeHtml(s) {
  let list = s.boards.filter(b => b !== 'english');
  if (!list.length) list = s.boards;
  return list.map(b => '<span class="board ' + b + '">' + BOARD_LABEL[b] + '</span>').join('');
}

// ---------- router ----------
function go(tab) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('page-' + tab);
  if (el) el.classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active',
    t.dataset.tab === tab || (tab === 'detail' && t.dataset.tab === 'schools') || (tab === 'blogpost' && t.dataset.tab === 'blogs')));
  const tabs = document.getElementById('tabs'); if (tabs) tabs.classList.remove('show');
  window.scrollTo({ top: 0 });
}
window.go = go;

// ---------- home voices + stats ----------
function renderVoices() {
  const box = document.getElementById('homeVoices'); if (!box) return;
  const pick = (id, i) => { const s = SCHOOLS.find(x => x.id === id); return s ? { q: s.revs[i], role: s.name } : null; };
  const picks = [pick('euro', 0), pick('prince', 0), pick('swami', 1)].filter(Boolean);
  box.innerHTML = picks.map(p =>
    '<div class="voice"><div class="st">\u2605\u2605\u2605\u2605\u2605</div><p>"' + esc(p.q) + '"</p><div class="who">Parent</div><div class="role">' + esc(p.role) + '</div></div>'
  ).join('');
  const ss = document.getElementById('statSchools'); if (ss) ss.textContent = SCHOOLS.length;
  const tot = SCHOOLS.reduce((a, s) => a + s.reviews, 0);
  const sr = document.getElementById('statReviews'); if (sr) sr.textContent = (tot >= 1000 ? (tot / 1000).toFixed(1) + 'k' : tot);
}

// ---------- schools ----------
let activeFilter = "all";
function setFilter(el) { document.querySelectorAll('.chip').forEach(c => c.classList.remove('active')); el.classList.add('active'); activeFilter = el.dataset.filter; renderSchools(); }
function setFilterByKey(k) { const el = document.querySelector('.chip[data-filter="' + k + '"]'); if (el) setFilter(el); }
window.setFilter = setFilter; window.setFilterByKey = setFilterByKey;

function renderSchools() {
  const grid = document.getElementById('schoolGrid'); if (!grid) return;
  const list = SCHOOLS.slice().sort((a, b) => {
    if (a.id === 'euro') return -1;   // Euro pinned #1
    if (b.id === 'euro') return 1;
    return b.reviews - a.reviews;     // rest by review count
  });
  const filtered = list.filter(s => activeFilter === "all" || s.boards.indexOf(activeFilter) > -1);
  document.getElementById('resultCount').textContent = filtered.length + (filtered.length === 1 ? " school" : " schools");
  grid.innerHTML = filtered.map((s, i) =>
    '<div class="card' + (s.featured ? ' featured' : '') + '" onclick="openSchool(\'' + s.id + '\')">'
    + '<div class="card-photo" style="' + cardPhoto(s) + '"><span class="rank">#' + (i + 1) + '</span>'
    + (s.featured ? '<span class="feat-badge">\u2605 Featured</span>' : '')
    + '<span class="boards">' + badgeHtml(s) + '</span></div>'
    + '<div class="card-body">'
    + '<h3>' + esc(s.name) + (s.verified ? ' <span class="verified" title="Verified listing">\u2714</span>' : '') + '</h3>'
    + '<div class="gm"><span class="sc">' + s.rating.toFixed(1) + '</span><span class="st">' + stars(s.rating) + '</span><span class="ct">' + s.reviews + ' reviews</span></div>'
    + '<div class="loc">\uD83D\uDCCD ' + esc(s.area) + '</div>'
    + '<div class="ph">\uD83D\uDCDE ' + esc(s.phone) + '</div>'
    + '<div class="open">View full details \u2192</div>'
    + '</div></div>'
  ).join('');
}
window.renderSchools = renderSchools;

function openSchool(id) {
  const s = SCHOOLS.find(x => x.id === id); if (!s) return;
  const gm = "https://www.google.com/maps/search/?api=1&query=" + s.lat + "," + s.lng;
  const lbls = ["Campus", "Classrooms", "Activities", "Sports", "Events"];
  const gallery = [0, 1, 2, 3, 4].map(n => {
    const realImg = (s.gallery && s.gallery[n]) ? s.gallery[n] : (n === 0 ? s.img : null);
    if (realImg) {
      return '<div style="background-image:linear-gradient(rgba(10,30,25,.05),rgba(10,30,25,.32)),url(\'' + realImg + '\');background-size:cover;background-position:center"><span class="lbl">' + lbls[n] + '</span></div>';
    }
    const h = (s.hue + n * 22) % 360;
    return '<div style="background:linear-gradient(135deg,hsl(' + h + ',44%,' + (46 - n * 3) + '%),hsl(' + ((h + 50) % 360) + ',40%,' + (30 - n * 2) + '%))"><span class="lbl">' + lbls[n] + '</span></div>';
  }).join('');
  document.getElementById('detailContent').innerHTML =
    '<div class="detail-hero"><div>'
    + '<h1>' + esc(s.name) + (s.verified ? ' <span class="verified" style="font-size:1.3rem">\u2714</span>' : '') + '</h1>'
    + '<div class="loc">\uD83D\uDCCD ' + esc(s.area) + ', Sikar, Rajasthan</div>'
    + '<div class="boards">' + s.tags.map(t => '<span class="tagpill">' + esc(t) + '</span>').join('') + '</div>'
    + '</div>'
    + '<div class="detail-score"><div class="big">' + s.rating.toFixed(1) + '</div><div class="st">' + stars(s.rating) + '</div><div class="ct">' + s.reviews + ' Google reviews</div></div>'
    + '</div>'
    + '<div class="gallery">' + gallery + '</div>'
    + (s.tagline ? '<div class="tagline-bar">' + esc(s.tagline) + '</div>' : '')
    + '<div class="detail-cols"><div>'
    + '<h3>About the school</h3><p class="about">' + esc(s.about) + '</p>'
    + (s.website ? '<a class="btn accent" href="' + s.website + '" target="_blank" rel="noopener" style="margin-bottom:26px">Visit Official Website \u2192</a>' : '')
    + (s.usps ? '<h3>Why ' + esc(shortName(s)) + '</h3><div class="usp-grid">'
      + s.usps.map(u => '<div class="usp"><div class="usp-t">' + esc(u[0]) + '</div><div class="usp-d">' + esc(u[1]) + '</div></div>').join('')
      + '</div>' : '')
    + (s.facilities ? '<h3>World-Class Facilities</h3><div class="pill-row">'
      + s.facilities.map(f => '<span class="pill">' + esc(f) + '</span>').join('') + '</div>' : '')
    + (s.achievements ? '<h3>Achievements</h3><ul class="tick-list">'
      + s.achievements.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>' : '')
    + (s.awards ? '<h3>Awards &amp; Recognition</h3><ul class="tick-list award">'
      + s.awards.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>' : '')
    + (s.fees ? '<h3>Fee Structure <span class="feeyear">2026-27</span></h3>'
      + '<table class="fee-table"><thead><tr><th>Grade</th><th>Annual Tuition Fee</th></tr></thead><tbody>'
      + s.fees.map(f => '<tr><td>' + esc(f[0]) + '</td><td>' + esc(f[1]) + '</td></tr>').join('')
      + '</tbody></table>'
      + (s.feeNote ? '<p class="feenote">' + esc(s.feeNote) + '</p>' : '')
      + (s.id === 'euro' ? '<a class="btn" href="' + s.website + '/admissions-euro-international-school#fee_structure" target="_blank" rel="noopener" style="margin-top:6px">See full fees & scholarships \u2192</a>' : '') : '')
    + '<h3>What parents &amp; students say</h3>'
    + s.revs.map(r => '<div class="rev"><div class="st">\u2605\u2605\u2605\u2605\u2605</div><p>"' + esc(r) + '"</p></div>').join('')
    + '</div><div>'
    + '<div class="infobox">'
    + (s.logo ? '<img src="' + s.logo + '" alt="' + esc(s.name) + '" style="width:100%;max-height:70px;object-fit:contain;background:var(--ink);border-radius:8px;padding:10px;margin-bottom:16px">' : '')
    + '<div class="ir"><span class="ik">Google rating</span><span class="iv">' + s.rating.toFixed(1) + ' \u2605</span></div>'
    + '<div class="ir"><span class="ik">Reviews</span><span class="iv">' + s.reviews + '</span></div>'
    + '<div class="ir"><span class="ik">Board / stream</span><span class="iv">' + esc(s.tags.join(', ')) + '</span></div>'
    + '<div class="ir"><span class="ik">Grades</span><span class="iv">' + esc(s.grades) + '</span></div>'
    + '<div class="ir"><span class="ik">Contact</span><span class="iv">' + esc(s.phone) + '</span></div>'
    + (s.email ? '<div class="ir"><span class="ik">Email</span><span class="iv" style="font-size:.8rem">' + esc(s.email) + '</span></div>' : '')
    + '<div class="ir"><span class="ik">Status</span><span class="iv" style="color:var(--verify)">' + (s.verified ? 'Verified \u2714' : 'Listed') + '</span></div>'
    + (s.website ? '<a class="btn primary maplink" href="' + s.website + '" target="_blank" rel="noopener">Visit Official Website</a>'
      + (s.id === 'euro' ? '<a class="btn maplink" href="' + s.website + '/admissions-euro-international-school" target="_blank" rel="noopener">Apply for Admission</a>' : '')
      + '<a class="btn maplink" href="' + gm + '" target="_blank" rel="noopener">Open in Google Maps</a>'
      + '<a class="btn maplink" href="tel:' + s.phone.replace(/\s/g, '') + '">Call the school</a>'
      : '<a class="btn primary maplink" href="' + gm + '" target="_blank" rel="noopener">Open in Google Maps</a>'
      + '<a class="btn maplink" href="tel:' + s.phone.replace(/\s/g, '') + '">Call the school</a>')
    + '</div></div></div>';
  go('detail');
}
window.openSchool = openSchool;

// ---------- blogs (READ ONLY from Supabase; no writing from the site) ----------
function renderBlogs() {
  const grid = document.getElementById('blogGrid'); if (!grid) return;
  const empty = document.getElementById('blogEmpty');
  if (!BLOGS.length) { grid.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';
  grid.innerHTML = BLOGS.map(b =>
    '<div class="blog" onclick="openBlog(' + jid(b.id) + ')">'
    + '<div class="blog-img" style="' + blogBg(b) + '"><span class="blog-tag">' + esc(b.cat) + '</span></div>'
    + '<div class="blog-body"><h4>' + esc(b.title) + '</h4>'
    + '<p>' + stripTags(b.body.replace(/\n/g, ' ')).slice(0, 110) + (b.body.length > 110 ? '...' : '') + '</p>'
    + '<div class="blog-date">' + esc(b.date) + ' \u00B7 ' + esc(b.author) + '</div></div></div>'
  ).join('');
}
function jid(id) { return typeof id === 'number' ? id : "'" + id + "'"; }

function openBlog(id) {
  const b = BLOGS.find(x => String(x.id) === String(id)); if (!b) return;
  document.getElementById('blogPostContent').innerHTML =
    '<div style="height:260px;border-radius:14px;margin:16px 0 24px;' + blogBg(b) + 'display:flex;align-items:flex-end;padding:18px"><span class="blog-tag">' + esc(b.cat) + '</span></div>'
    + '<h1 style="font-size:clamp(1.9rem,4vw,2.8rem);letter-spacing:-.02em;line-height:1.1">' + esc(b.title) + '</h1>'
    + '<div class="sans" style="color:var(--muted);font-size:.85rem;margin:12px 0 24px;text-transform:uppercase;letter-spacing:.06em">' + esc(b.date) + ' \u00B7 ' + esc(b.author) + ' \u00B7 ' + esc(b.cat) + '</div>'
    + b.body.split('\n').filter(x => x.trim()).map(p => '<p class="sans" style="font-size:1.05rem;color:#2b3b40;margin-bottom:18px">' + safeBody(p) + '</p>').join('')
    + (b.source_name && b.source_url
      ? '<p class="sans" style="font-size:.85rem;color:var(--muted);margin-top:24px;border-top:1px solid var(--line);padding-top:16px">Inspired by reporting from <a href="' + encodeURI(b.source_url) + '" target="_blank" rel="noopener">' + esc(b.source_name) + '</a>.</p>'
      : '');
  go('blogpost');
}
window.openBlog = openBlog;

async function loadBlogs() {
  if (!sb) { renderBlogs(); return; }   // demo fallback if not configured
  try {
    const { data, error } = await sb.from('blog_posts')
      .select('*').eq('status', 'published').order('created_at', { ascending: false });
    if (error) throw error;
    const hues = [158, 24, 222, 300, 190, 16, 130];
    BLOGS = data.map((p, i) => ({
      id: p.id, title: p.title, cat: p.category, author: p.author, body: p.body, img: p.image_url,
      source_name: p.source_name, source_url: p.source_url,
      date: new Date(p.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      hue: hues[i % hues.length]
    }));
    renderBlogs();
  } catch (err) {
    console.error('loadBlogs failed:', err);
    renderBlogs();
  }
}

// ---------- init ----------
document.addEventListener('DOMContentLoaded', function () {
  renderVoices();
  renderSchools();
  loadBlogs();
});
