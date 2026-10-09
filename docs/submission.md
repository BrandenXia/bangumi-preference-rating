# Bangumi submission

Component: [个性化评分](https://bgm.tv/dev/app/7267)

Development version: [0.3.2](https://bangumi.tv/dev/app/7267/gadget/3887).

The updated version is enabled for the author and submitted for public review (审核中). The own-profile refinement entry appears below rating statistics, and supports category comparisons and confirmed selected batch updates. Subject preference scoring appears below the default rating chart in the collection panel; the floating window follows Bangumi typography and theme colors.

Build with `npm ci && npm run build`. Paste the complete readable `dist/bangumi-preference-rating.js` into the **脚本** field; the **样式** field stays empty because the script includes its scoped CSS. There are no third-party runtime libraries or remote script imports. The component's cross-origin API checkbox is enabled for its requests to `api.bgm.tv`.

The saved description explains separate category pools, the 50-rating threshold, local comparison storage, JSON backups, noisy pairwise evidence, and confirmed selected batch updates with all/none selection. Homepage points to the GitHub repository; primary category is **评分与统计**.

Verified on signed-in `bgm.tv`: native script loading, anime/book/adult-game entry points, per-category gates, public API collection import, IndexedDB persistence, skip/undo across reload, JSON text round trip, and native personalization registration. Version 0.2.0 was also verified on signed-in `bangumi.tv`: own-profile placement, public import, category comparisons and skip/undo. Batch writes passed local mock tests, including preserved fields and partial failures; real rating writes were not performed. Ten core tests and TypeScript/build checks pass. A native screenshot is available locally from the release check; no account data is included in the repository.

Version 0.2.1 includes unscored public collections in category refinement and selected first-score updates. Native import confirmed separate rated/unscored counts; a two-item first-score batch passed the mock native-form check.

Version 0.2.2 restricts imported scoring references and targets to completed public collections. Legacy collection imports require refresh, preserving comparison history. Batch publication checks that the live native status is still completed.

Release scope: local preference scoring using completed public collections. Selected score updates use the signed-in native collection form and verify each result. Private collection imports remain deferred. The window works for adult subjects using metadata already visible in the page; public API access rules remain unchanged.

Version 0.3.0 adds the own-profile refined-rating ranking panel and adjustable score spread, defaulting to 2× latent deviations about each category mean. Completed-only scope and category gates remain unchanged. Scores and integer suggestions are recomputed from saved comparisons; publication stays selected and confirmed.

The saved 0.3.0 bundle was compared with the local build. Signed-in native checks verified the homepage ranking entry, completed-only table and spread controls. The version is submitted for review (审核中). Mock rankings demonstrated original range 5.00–6.82 versus default expanded range 4.10–7.68, with unchanged ordering and matching batch-review suggestions.

Version 0.3.1 adds continuous refinement in sessions of at most 20 choices. The scheduler prioritizes close scores and under-observed pairs, avoids the last 20 combinations, and resumes from persisted history. Full-pool coverage remains optional. Mock checks verified the 20-choice pause, undo to 19, another session and early review; core coverage includes a 300-subject pool.

The saved 0.3.1 bundle matches the local build. Signed-in native checks verified the continuous 0/20 session and close-score pairing; the version is submitted for review (审核中). No real preference choices or rating writes were made during this release check.

Version 0.3.2 replaces latent stretching with category percentile calibration: suggestions have a 4-point floor, integer 9 targets about 1/40 of a differentiated category pool, and the component never assigns 10. Users choose 10 manually on Bangumi. Ties share midpoint percentiles, and spread changes only the middle band. Existing comparisons and backups remain usable.

The saved 0.3.2 bundle matches the local build and is submitted for review (审核中). Native verification confirmed the updated ranking panel explanation; mock ranking and review confirmed the new scores and middle-spread control. Both models pass floor, tail and tie checks. No real preferences or ratings were changed.
