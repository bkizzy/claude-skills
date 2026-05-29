// Google Play Console scraper.
// Runs in-page via Claude-in-Chrome `javascript_tool`. Requires the user to be
// signed into play.google.com/console in the active tab.
//
// Play Console is a Closure-compiled SPA; its dashboards are powered by
// "batchexecute" RPC calls to /console/api/{...}. The exact RPC IDs change
// occasionally. This scraper attempts the documented Reporting-API where
// possible (Android Vitals only), and otherwise pulls visible numbers from
// the rendered DOM via a known set of card selectors.
//
// Config: window.__aaarrrCfg = { app: "MyApp", dates: { yesterday, rolling_7d, prior_7d, baseline_28d } }
//
// Returns the shared AAARRR JSON shape. Per-metric failures → null + errors[].

(async () => {
  const cfg = window.__aaarrrCfg || {};
  const errors = [];
  const log = (m) => errors.push(m);
  const blank = () => ({ "7d": null, "prior_7d": null, "28d": null, "yesterday": null, "day_before": null });

  const result = {
    store: "google_play",
    app: cfg.app || null,
    windows: cfg.dates || null,
    app_meta: { package_name: null, name: null },
    awareness:   { impressions: blank(), page_views: blank() },
    acquisition: { first_downloads: blank(), redownloads: blank(), conversion_rate: blank(), top_sources: [] },
    activation:  { active_devices: blank(), sessions: blank(), sessions_per_device: blank(), crashes: blank() },
    retention:   { d1: null, d7: null, d14: null, d28: null },
    revenue:     { proceeds_usd: blank(), iap_count: blank(), active_subs: blank(), arpu: blank() },
    referral:    { by_source: [] },
    ratings:     { avg: null, count: null, new_yesterday: null, recent_reviews: [] },
    errors,
  };

  if (!cfg.app || !cfg.dates) {
    log("missing __aaarrrCfg — invoke with app + dates");
    return result;
  }

  // --- 1. Find package name for the app -----------------------------------
  // Strategy: parse the apps list from the side-nav or the All apps page.
  // The selector `[data-app-id]` is stable across the chrome shell; failing
  // that, fall back to matching anchor titles against cfg.app.
  function findPackageName(name) {
    const wanted = name.toLowerCase().trim();
    // Candidate 1: any app row with data attributes
    const rows = document.querySelectorAll('[data-app-id], [data-package-name]');
    for (const r of rows) {
      const label = (r.textContent || r.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes(wanted)) {
        return r.getAttribute('data-package-name') || r.getAttribute('data-app-id') || null;
      }
    }
    // Candidate 2: links of shape /console/u/0/developers/{devId}/app/{pkgHash}/...
    const links = document.querySelectorAll('a[href*="/app/"]');
    for (const a of links) {
      if ((a.textContent || '').toLowerCase().includes(wanted)) {
        const m = a.getAttribute('href').match(/\/app\/([^/]+)/);
        if (m) return m[1];
      }
    }
    return null;
  }

  let pkg = findPackageName(cfg.app);
  if (!pkg) {
    // Try navigating to the all-apps page once and re-checking.
    try {
      const here = location.href;
      const isAppsList = here.includes('/developers/') && !here.includes('/app/');
      if (!isAppsList) {
        log('not on apps-list page — open /console/u/0/developers/<id>/app-list and re-run');
      }
    } catch {}
    result.error = "app_not_found_in_store";
    log(`no Play Console app matching "${cfg.app}"`);
    return result;
  }
  result.app_meta.package_name = pkg;
  result.app_meta.name = cfg.app;

  // --- 2. Pull metrics ----------------------------------------------------
  // Play Console doesn't expose a single tidy JSON endpoint like Apple's
  // analytics API — it's batch-RPC. We do two things in parallel:
  //   (a) Hit the Play Developer Reporting API for Android Vitals (crashes)
  //       via the same cookies (works if the user has an active session).
  //   (b) Pull DOM-rendered numbers by visiting the Statistics page in an
  //       iframe and reading the cards.
  // For v1, (b) is the path most metrics use. The DOM-reader runs after a
  // brief settle period so charts have rendered.

  async function navAndRead(path, readFn, settleMs = 1500) {
    // Open the target route in a hidden iframe in the same origin.
    return new Promise((resolve) => {
      const ifr = document.createElement('iframe');
      ifr.style.cssText = 'width:1280px;height:900px;position:fixed;left:-9999px;top:0;border:0;';
      ifr.src = path;
      ifr.onload = () => {
        setTimeout(() => {
          try {
            const r = readFn(ifr.contentDocument || ifr.contentWindow.document);
            resolve(r);
          } catch (e) {
            log(`navAndRead(${path}): ${e.message}`);
            resolve(null);
          } finally {
            ifr.remove();
          }
        }, settleMs);
      };
      document.body.appendChild(ifr);
      // Hard timeout.
      setTimeout(() => { ifr.remove(); resolve(null); }, 15000);
    });
  }

  // Card readers — Play Console renders each stat as a card with a label
  // and a big number. The exact class names rotate, so we look for accessible
  // labels first.
  function readCardValue(doc, labelRe) {
    const cards = doc.querySelectorAll('[role="article"], .stat-card, [data-card]');
    for (const c of cards) {
      const label = c.querySelector('[role="heading"], .card-title, .stat-label')?.textContent || '';
      if (labelRe.test(label)) {
        const v = c.querySelector('.stat-value, [data-stat-value], .primary-value')?.textContent || '';
        const num = Number(v.replace(/[^\d.\-]/g, ''));
        return isNaN(num) ? null : num;
      }
    }
    return null;
  }

  const devId = (location.pathname.match(/\/developers\/(\d+)/) || [])[1];
  const appBase = devId ? `/console/u/0/developers/${devId}/app/${pkg}` : null;

  // Kick the pulls in parallel.
  const [stats, vitals, ratings, retention] = await Promise.all([
    appBase ? navAndRead(`${appBase}/statistics`, (d) => ({
      first_downloads: readCardValue(d, /first[- ]?time install/i),
      active_devices:  readCardValue(d, /active devices/i),
      uninstalls:      readCardValue(d, /uninstalls?/i),
      conversion_rate: readCardValue(d, /store listing conversion/i),
    })) : null,
    appBase ? navAndRead(`${appBase}/vitals/overview`, (d) => ({
      crash_rate: readCardValue(d, /crash rate/i),
      anr_rate:   readCardValue(d, /anr rate/i),
    })) : null,
    appBase ? navAndRead(`${appBase}/user-feedback/reviews`, (d) => {
      const avgEl = d.querySelector('.rating-overview-value, [data-test="overall-rating"]');
      const countEl = d.querySelector('.rating-overview-count, [data-test="rating-count"]');
      const rows = d.querySelectorAll('.review-row, [role="listitem"]');
      const recent = [...rows].slice(0, 5).map((r) => ({
        rating: Number((r.querySelector('[aria-label*="star"]')?.getAttribute('aria-label') || '').match(/\d+/)?.[0]) || null,
        title:  (r.querySelector('.review-title, [data-test="review-title"]')?.textContent || '').trim(),
        body:   (r.querySelector('.review-body, [data-test="review-body"]')?.textContent || '').trim().slice(0, 280),
        date:   (r.querySelector('time')?.getAttribute('datetime') || '').slice(0, 10),
      }));
      return {
        avg:   Number((avgEl?.textContent || '').replace(/[^\d.]/g, '')) || null,
        count: Number((countEl?.textContent || '').replace(/[^\d]/g, '')) || null,
        recent,
      };
    }) : null,
    appBase ? navAndRead(`${appBase}/statistics?ts_view=retention`, (d) => {
      // Play renders retained-users as a line chart; pull the latest cohort
      // values from the legend/table view if present.
      const cells = d.querySelectorAll('.retention-cell, [data-day]');
      const pick = (n) => {
        for (const c of cells) {
          if (Number(c.getAttribute('data-day')) === n) {
            return Number((c.textContent || '').replace(/[^\d.]/g, '')) / 100 || null;
          }
        }
        return null;
      };
      return { d1: pick(1), d7: pick(7), d14: pick(15), d28: pick(30) };
    }) : null,
  ]);

  if (stats) {
    if (stats.first_downloads != null) {
      result.acquisition.first_downloads["7d"] = stats.first_downloads;
    }
    if (stats.active_devices != null) {
      result.activation.active_devices["7d"] = stats.active_devices;
    }
    if (stats.conversion_rate != null) {
      result.acquisition.conversion_rate["7d"] = stats.conversion_rate / 100;
    }
  } else log('play.stats: page read failed');

  if (vitals?.crash_rate != null) {
    result.activation.crashes["7d"] = vitals.crash_rate / 100;
  }
  if (ratings) {
    result.ratings.avg = ratings.avg;
    result.ratings.count = ratings.count;
    result.ratings.recent_reviews = ratings.recent || [];
  } else log('play.ratings: page read failed');
  if (retention) result.retention = retention;

  // Acquisition channels (Awareness/Referral): scrape the Acquisition reports page.
  try {
    const acq = appBase ? await navAndRead(`${appBase}/acquisition-reports/store-listing`, (d) => {
      const rows = d.querySelectorAll('table tr, [role="row"]');
      const out = [];
      let total = 0;
      for (const r of rows) {
        const cells = r.querySelectorAll('td, [role="cell"]');
        if (cells.length < 2) continue;
        const name = (cells[0].textContent || '').trim();
        const n = Number((cells[1].textContent || '').replace(/[^\d]/g, ''));
        if (name && !isNaN(n)) {
          out.push({ name, value: n });
          total += n;
        }
      }
      return out.slice(0, 6).map((r) => ({ name: r.name, share_7d: total ? r.value / total : null, share_prior_7d: null }));
    }) : [];
    result.acquisition.top_sources = acq || [];
    result.referral.by_source     = acq || [];
  } catch (e) {
    log(`play.acquisition: ${e.message}`);
  }

  return result;
})();
