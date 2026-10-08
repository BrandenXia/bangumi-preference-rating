# Bangumi submission

Component: [个性化评分](https://bgm.tv/dev/app/7267)

Development version: [0.1.0](https://bgm.tv/dev/app/7267/gadget/3887)

The script is saved as an unreviewed developer version and enabled for the author. It has **not** been submitted for public review. Use the component page's **提交审核** button when ready to submit.

Build with `npm ci && npm run build`. Paste the complete readable `dist/bangumi-preference-rating.js` into the **脚本** field; the **样式** field stays empty because the script includes its scoped CSS. There are no third-party runtime libraries or remote script imports. The component's cross-origin API checkbox is enabled for its requests to `api.bgm.tv`.

The saved description explains separate category pools, the 50-rating threshold, local-only storage, JSON backups, and manual integer ratings. Homepage points to the GitHub repository; primary category is **评分与统计**.

Verified on signed-in `bgm.tv`: native script loading, anime/book/adult-game entry points, per-category gates, public API collection import, IndexedDB persistence, skip/undo across reload, JSON text round trip, and native personalization registration. Core model tests and TypeScript/build checks pass. A native screenshot is available locally from the release check; no account data is included in the repository.

Release scope: local preference scoring using public ratings. Authenticated publishing and private collections are deferred. The window works for adult subjects using metadata already visible in the page; public API access rules remain unchanged.
