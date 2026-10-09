# Bangumi submission

Component: [个性化评分](https://bgm.tv/dev/app/7267)

Development version: [0.2.0](https://bgm.tv/dev/app/7267/gadget/3887)

The updated version is enabled for the author and submitted for public review (审核中). The own-profile refinement entry appears below rating statistics, and supports category comparisons and confirmed selected batch updates. Subject preference scoring appears below the default rating chart in the collection panel; the floating window follows Bangumi typography and theme colors.

Build with `npm ci && npm run build`. Paste the complete readable `dist/bangumi-preference-rating.js` into the **脚本** field; the **样式** field stays empty because the script includes its scoped CSS. There are no third-party runtime libraries or remote script imports. The component's cross-origin API checkbox is enabled for its requests to `api.bgm.tv`.

The saved description explains separate category pools, the 50-rating threshold, local comparison storage, JSON backups, noisy pairwise evidence, and confirmed selected batch updates with all/none selection. Homepage points to the GitHub repository; primary category is **评分与统计**.

Verified on signed-in `bgm.tv`: native script loading, anime/book/adult-game entry points, per-category gates, public API collection import, IndexedDB persistence, skip/undo across reload, JSON text round trip, and native personalization registration. Version 0.2.0 was also verified on signed-in `bangumi.tv`: own-profile placement, public import, category comparisons and skip/undo. Batch writes passed local mock tests, including preserved fields and partial failures; real rating writes were not performed. Six core tests and TypeScript/build checks pass. A native screenshot is available locally from the release check; no account data is included in the repository.

Release scope: local preference scoring using public ratings. Selected score updates use the signed-in native collection form and verify each result. Private collection imports remain deferred. The window works for adult subjects using metadata already visible in the page; public API access rules remain unchanged.
