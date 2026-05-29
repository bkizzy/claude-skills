// Public apps.apple.com page scraper.
// Runs in-page via Claude-in-Chrome `javascript_tool` AFTER navigating to
// `https://apps.apple.com/us/app/id<APP_STORE_ID>`. No login required.
//
// Pulls: average rating, total rating count, recent visible reviews, and
// editorial / featured-shelf presence (a soft Awareness signal).
//
// Config arrives on `window.__aaarrrCfg`: { app: "MyApp", dates: { ... } }.
// Returns a flat object that the SKILL merges under `asc_public` on the
// private-scrape result.

(async () => {
  const errors = [];
  const log = (m) => errors.push(m);
  const out = {
    fetched_at: new Date().toISOString(),
    rating: { avg: null, count: null },
    rank: { category: null, position: null },
    editorial: { today_featured: false, story_count: 0 },
    recent_reviews: [],
    errors,
  };

  // Average rating + count from the structured-data JSON-LD block (most stable
  // surface; the visual stars change layout often but JSON-LD is consistent).
  try {
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => { try { return JSON.parse(s.textContent); } catch { return null; } })
      .filter(Boolean);
    const app = ld.find((o) => o["@type"] === "SoftwareApplication" || o.applicationCategory);
    if (app && app.aggregateRating) {
      out.rating.avg = Number(app.aggregateRating.ratingValue) || null;
      out.rating.count = Number(app.aggregateRating.reviewCount || app.aggregateRating.ratingCount) || null;
    }
  } catch (e) {
    log(`asc_public.rating: ${e.message}`);
  }

  // Recent reviews (a few are inlined on the page).
  try {
    const cards = document.querySelectorAll(".we-customer-review");
    out.recent_reviews = [...cards].slice(0, 5).map((el) => ({
      rating: Number((el.querySelector(".we-star-rating, [aria-label*='out of 5']")?.getAttribute("aria-label") || "")
                .match(/([\d.]+)/)?.[1]) || null,
      title:  (el.querySelector(".we-customer-review__title")?.textContent || "").trim(),
      body:   (el.querySelector(".we-customer-review__body, .we-clamp")?.textContent || "").trim().slice(0, 280),
      author: (el.querySelector(".we-customer-review__user")?.textContent || "").trim(),
      date:   (el.querySelector("time")?.getAttribute("datetime") || "").slice(0, 10),
    }));
  } catch (e) {
    log(`asc_public.reviews: ${e.message}`);
  }

  // Editorial / Today badge — a strong awareness signal when present.
  try {
    const editorial = document.querySelector('[data-test-editorial-badge], .we-editorial-section');
    out.editorial.today_featured = !!editorial;
    out.editorial.story_count = document.querySelectorAll('.we-editorial-section, .we-editorial-card').length;
  } catch (e) {
    log(`asc_public.editorial: ${e.message}`);
  }

  // Category rank if visible (Apple shows this on chart-eligible apps only).
  try {
    const rankEl = document.querySelector('[data-test-app-info-chart-position], .product-header__chart-position');
    if (rankEl) {
      const text = rankEl.textContent || "";
      const m = text.match(/#(\d+)\s*in\s*([\w &]+)/i);
      if (m) {
        out.rank.position = Number(m[1]);
        out.rank.category = m[2].trim();
      }
    }
  } catch (e) {
    log(`asc_public.rank: ${e.message}`);
  }

  return out;
})();
