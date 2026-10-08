# Implementation notes

The supplied plan is a reference. This version prioritizes a working native component over a framework, plugin registry, backend, cloud sync, or a large test suite. One esbuild bundle, TypeScript, browser APIs, and a handful of modules are enough.

## Platform findings (2026-10-08)

- [Component scopes](https://bgm.tv/group/topic/345291) use userscript metadata; this bundle matches all pages on the three Bangumi hosts so settings are available everywhere. The subject action itself checks the exact detail route and API subject type. Comparisons run in a native floating `<dialog>` within Bangumi, with no separate rating website.
- [Personalization](https://bgm.tv/group/topic/435098) exposes `chiiLib.ukagaka.addGeneralConfig`. It is optional; the comparison dialog also has settings.
- [Cloud settings](https://bgm.tv/group/topic/435662) load on every page and are deleted on disabling a component. History stays in IndexedDB, one record per numeric user ID, separately on each origin.
- [Official v0 schema](https://github.com/bangumi/api/blob/master/open-api/v0.yaml) allows public collections without a bearer token, offset pagination, and limit at most 50. We import all subject types and keep book (1), anime (2), music (3), game (4), and live action (6) pools separate. Each category needs 50 rated subjects independently; other categories never affect its prior, comparisons, or calibration. Private collections require authorization. Collection status and zero ratings do not count toward eligibility.
- [OAuth](https://github.com/bangumi/api/blob/master/docs-raw/How-to-Auth.md) requires a client secret for the documented code exchange. We do not embed secrets or assume site cookies authorize the API. This release has no remote write path. Integer recommendations can be entered manually in Bangumi's existing controls.
- The public subject page and read-only subject API were fetched successfully; the API returned `access-control-allow-origin: *`. The developer component editor requires login. Native install, authenticated identity markup, personalization execution, private collections, cross-origin browser fetching, and all three hostnames still require a signed-in browser check. No remote ratings were changed.

## Scope

Ship: paginated public imports, 50-rating gate, local comparison history, adaptive references, undo/skip/tie, saved precise estimates, two algorithms, backup/restore. Native DOM integration is best effort and fails closed when the logged-in navigation identity cannot be detected. Failed imports keep the previous snapshot. Successful imports revalidate eligibility, even when it falls below 50; past comparisons and records remain.

Defer: authenticated publishing, private collection access, full hierarchical Bayesian inference, learned ordinal thresholds, globally refitting every anchor, and cloud synchronization. These do not justify extra architecture in the first version.

## Scoring

Default: conditional Bradley–Terry MAP, with a Gaussian shrinkage prior. Each reference gets a latent mean from a noisy cumulative-logit rating observation and a weak centered Gaussian prior. Nine fixed ordered cutpoints (spacing 0.8, centered at zero) identify latent location/scale. Category probabilities yield an expected score in 1–10; the integer suggestion rounds that expectation. Cutpoints are deliberately fixed rather than jointly learned. This is not full hierarchical Bayesian inference.

Decisive preferences use logistic likelihoods; ties use a soft quadratic equality penalty. Skips are stored but do not enter inference. The displayed sensitivity range uses conditional Laplace curvature plus a noise floor, not a calibrated credible interval. Elo replays the same raw history sequentially against fixed references and does not report an interval. Model changes preview/recompute local scores only. Original, currently imported, and last published ratings are distinct fields; this version never populates the last published field itself.

Reference selection minimizes latent distance, a cheap `p(1-p)` information proxy, and avoids previously seen references. Eight useful comparisons is a session budget, not a claim of convergence; the user can continue. Missing anchors after refresh are ignored as evidence. Concentrated ratings show a warning.

Backup schema 2 adds categories; schema 1 anime-only backups migrate automatically. Imports validate category membership and account ownership, then recompute derived scores. IndexedDB writes check revisions atomically to avoid overwriting changes from another tab.

## Verification

Four core tests cover the rating threshold, per-category isolation, both models, calibration order, skips/ties, backup validation/migration and API pagination. Typecheck and bundle build run separately. `tests/preview.html` is an offline mock Bangumi page for manual browser checks only; it is not an application entry point or included in the build. Serve the repository locally after building and open that fixture to check the floating dialog. The mock uses a disposable user ID and blocks actual network requests.
